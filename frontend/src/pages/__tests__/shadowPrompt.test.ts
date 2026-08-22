import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/pages/ShadowAccount";

/**
 * Port of `_ACTIONABLE_MARKET_RE` from agent/src/agent/grounding.py.
 *
 * When a user message matches, the grounding layer pins identity_status to
 * "unresolved", which blocks `load_skill` for the entire run. The model's
 * recovery from that block is nondeterministic — observed runs variously
 * called the Shadow tools anyway, refused the task outright, or silently
 * downgraded to `analyze_trade_journal` and skipped the backtest entirely.
 *
 * The Shadow Account kickoff prompt must therefore never match. If someone
 * rewords it back to "trade dates" or "entry/exit rules", this fails.
 */
const ACTIONABLE_MARKET_RE = new RegExp(
  "(?:\\bbuy\\b|\\bsell\\b|\\bentry\\b|\\btarget price\\b|\\bcurrent price\\b|" +
    "\\blatest price\\b|\\bprice of\\b|\\btrade\\b|" +
    "\\bvaluation of\\b|\\bwhat (?:is|are) .{1,80} worth\\b|" +
    "\\bis .{1,80} (?:listed|publicly traded)\\b|" +
    "买入|卖出|入场|目标价|现价|最新价|股价|交易价格|估值|值多少钱)",
  "i",
);

describe("Shadow Account kickoff prompt", () => {
  const prompt = buildPrompt("uploads/abc123.csv", "my_trades.csv");

  it("does not trip the grounding identity gate", () => {
    const match = prompt.match(ACTIONABLE_MARKET_RE);
    expect(
      match,
      match
        ? `Prompt contains "${match[0]}", which pins identity_status to ` +
            `"unresolved" and blocks load_skill. Reword it — see the ` +
            `WORDING CONSTRAINT note on buildPrompt.`
        : undefined,
    ).toBeNull();
  });

  it("passes the uploaded path to both Shadow tools", () => {
    expect(prompt).toContain('extract_shadow_strategy` with journal_path="uploads/abc123.csv"');
    expect(prompt).toContain("run_shadow_backtest");
    expect(prompt).toContain("uploads/abc123.csv");
  });

  it("pins the backtest window to the journal, not the tool default", () => {
    // Without this the tool silently uses today-minus-one-year, which for a
    // historical journal overlaps nothing and yields meaningless attribution.
    expect(prompt).toMatch(/earliest and latest dated rows/i);
  });

  it("instructs the agent not to dress up an empty backtest as findings", () => {
    expect(prompt).toMatch(/too small to support a conclusion/i);
    expect(prompt).toMatch(/returns nothing or empty metrics/i);
  });

  it("carries the original filename through for context", () => {
    expect(prompt).toContain("my_trades.csv");
  });
});
