"""Regression test for broker exports that qualify the side with an order type.

Trading 212 (and Freetrade / Revolut, which share the shape) writes the side as
"Market buy" / "Market sell" rather than a bare "buy" / "sell", and spells the
numeric columns out as "No. of shares", "Price / share" and "Total".

Before the fix, _normalize_side raised ``Unsupported trade side: 'Market buy'``
on the first such row, so analyze_trade_journal and extract_shadow_strategy
both failed and the whole Shadow Account flow produced nothing. The quantity
and price columns were separately unmatched, which would have yielded records
with no size even once the side parsed.

Observed downstream: rather than surface the parse error, the agent tried to
rewrite the user's uploaded CSV in place and retry — 85 tool steps of
alternating failures and 20-to-30-edit rewrites without terminating.
"""

import pandas as pd
import pytest

from src.tools.trade_journal_parsers import _normalize_side, detect_format, parse_generic


TRADING_212_COLUMNS = [
    "Action", "Time", "Ticker", "Name", "No. of shares", "Price / share",
    "Currency (Price / share)", "Exchange rate", "Total", "Currency (Total)", "Fee", "ID",
]


def _row(action: str, ticker: str, shares: float, price: float) -> dict:
    return {
        "Action": action,
        "Time": "2024-02-07 17:48:00",
        "Ticker": ticker,
        "Name": ticker,
        "No. of shares": shares,
        "Price / share": price,
        "Currency (Price / share)": "USD",
        "Exchange rate": 1.0,
        "Total": shares * price,
        "Currency (Total)": "USD",
        "Fee": 2.93,
        "ID": f"TX{ticker}",
    }


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Market buy", "buy"),
        ("Market sell", "sell"),
        ("Limit buy", "buy"),
        ("Limit sell", "sell"),
        ("Stop sell", "sell"),
        ("Stop limit buy", "buy"),
        ("buy market", "buy"),
        # Bare sides must keep working.
        ("buy", "buy"),
        ("sell", "sell"),
        ("BUY", "buy"),
        # A multi-word side that carries meaning must not be truncated by the
        # order-type stripping.
        ("buy to cover", "buy"),
        ("sell short", "sell"),
    ],
)
def test_order_type_qualified_sides_normalize(raw: str, expected: str) -> None:
    assert _normalize_side(raw) == expected


def test_genuinely_unknown_side_still_raises() -> None:
    """Stripping must not turn nonsense into a silent default."""
    with pytest.raises(ValueError, match="Unsupported trade side"):
        _normalize_side("dividend")
    with pytest.raises(ValueError, match="Unsupported trade side"):
        _normalize_side("market")


def test_trading_212_export_parses_fully() -> None:
    """A mixed bare/qualified export parses every row with size and price."""
    df = pd.DataFrame(
        [
            _row("buy", "MSFT", 6, 406.70),
            _row("Market buy", "AMD", 18, 136.78),
            _row("sell", "MSFT", 6, 420.15),
            _row("Market sell", "AMD", 18, 128.40),
        ],
        columns=TRADING_212_COLUMNS,
    )

    assert detect_format(df) == "generic"

    records = parse_generic(df)
    assert len(records) == 4, "every row should parse, including qualified sides"
    assert [r.side for r in records] == ["buy", "buy", "sell", "sell"]

    # "No. of shares" and "Price / share" must map through, or records arrive
    # sized zero and every downstream metric is meaningless.
    assert all(r.quantity for r in records), "quantity column did not map"
    assert all(r.price for r in records), "price column did not map"
    assert records[0].quantity == 6
    assert records[0].price == pytest.approx(406.70)
