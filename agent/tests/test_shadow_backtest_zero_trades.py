"""Regression tests for the two defects that made every Shadow backtest empty.

Both were silent: the flow reported "0 trades / no metrics" rather than an
error, so the Shadow Account gap looked like a modelling limitation instead of
two bugs.

1. ``backtest.runner`` sets ``bars_per_year=None`` as a deliberate sentinel
   meaning "annualize by calendar span" whenever a run spans market types with
   different calendars. ``compute_risk_xray`` was typed ``periods_per_year:
   int`` and passed the sentinel straight into ``math.sqrt``, raising
   ``TypeError: must be real number, not NoneType``. The caller in
   ``engines/base.py`` catches only ``ValueError``, so the TypeError aborted
   the whole backtest after it had already succeeded, and no metrics.csv was
   written.

   This fired on every Shadow run: the default market set puts ``us`` and
   ``crypto`` in one USD currency pool, which is by definition mixed-calendar.
   The CNY (china_a) and HKD (hk) pools are single-market and survived, which
   is why partial results appeared while the headline pool vanished.

2. ``_attribution_or_zero`` read the shadow's absolute PnL from
   ``total_return_abs`` / ``total_pnl``. The composite engine emits neither —
   it emits ``final_value`` and ``total_return`` — so shadow_pnl resolved to
   0.0 on every run and ``delta_pnl`` degenerated to the negated journal PnL.
"""

import numpy as np
import pandas as pd
import pytest

from backtest.risk_xray import compute_risk_xray, _resolve_periods_per_year
from src.shadow_account.backtester import _shadow_pnl_from


def _panel(days: int = 300) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=days, freq="D")
    rng = np.random.default_rng(0)
    return pd.DataFrame(
        {
            "AAPL.US": 100 * np.cumprod(1 + rng.normal(0, 0.01, days)),
            "BTC-USDT": 40000 * np.cumprod(1 + rng.normal(0, 0.02, days)),
        },
        index=idx,
    )


class TestCrossMarketAnnualization:
    def test_none_sentinel_does_not_raise(self) -> None:
        """The mixed-calendar USD pool case that killed every Shadow run."""
        result = compute_risk_xray(
            _panel(), {"AAPL.US": 0.5, "BTC-USDT": 0.5}, periods_per_year=None,
        )
        vol = result["volatility"]
        assert vol["annualized_vol"] is not None
        assert vol["annualized_vol"] > 0
        assert vol["downside_deviation_annualized"] is not None

    def test_explicit_factor_is_unchanged(self) -> None:
        """Single-market runs must keep their exact previous annualization."""
        result = compute_risk_xray(
            _panel(), {"AAPL.US": 0.5, "BTC-USDT": 0.5}, periods_per_year=252,
        )
        daily = result["volatility"]["daily_vol"]
        assert result["volatility"]["annualized_vol"] == pytest.approx(
            daily * np.sqrt(252)
        )

    def test_sentinel_resolves_to_calendar_span(self) -> None:
        idx = pd.date_range("2024-01-01", periods=300, freq="D")
        # ~300 bars across ~300 calendar days annualizes near 365, not 252.
        assert _resolve_periods_per_year(None, idx) > 300
        assert _resolve_periods_per_year(252, idx) == 252

    @pytest.mark.parametrize("index", [pd.Index([]), pd.DatetimeIndex(["2024-01-01"])])
    def test_degenerate_index_falls_back(self, index: pd.Index) -> None:
        """Too few bars to measure a span must not divide by zero."""
        assert _resolve_periods_per_year(None, index) == 252


class TestShadowPnlDerivation:
    def test_derives_from_final_value(self) -> None:
        assert _shadow_pnl_from({"final_value": 1_170_867.49}, 1_000_000.0) == pytest.approx(170_867.49)

    def test_falls_back_to_total_return(self) -> None:
        assert _shadow_pnl_from({"total_return": 0.25}, 1_000_000.0) == pytest.approx(250_000.0)

    def test_legacy_keys_absent_no_longer_means_zero(self) -> None:
        """The exact shape the engine emits — neither legacy key present."""
        combined = {"final_value": 1_170_867.49, "total_return": 0.1708674878924299}
        assert "total_return_abs" not in combined
        assert "total_pnl" not in combined
        assert _shadow_pnl_from(combined, 1_000_000.0) != 0.0

    def test_empty_metrics_still_zero(self) -> None:
        """A pool that genuinely produced nothing must not invent PnL."""
        assert _shadow_pnl_from({}, 1_000_000.0) == 0.0
