import i18n from "@/i18n";
import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { Fingerprint, FileSpreadsheet, Loader2, TriangleAlert, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

// Mirrors the server-side allowlist in agent/src/api/uploads_routes.py. Broker
// exports arrive as CSV/TSV far more often than Excel, but 同花顺 / 富途 both
// offer .xlsx exports, so accept those too.
const ACCEPTED_EXT = [".csv", ".tsv", ".xlsx", ".xls"] as const;

// The backend rejects >50MB with a 413. Checking client-side turns a failed
// round trip into an instant, specific message.
const MAX_BYTES = 50 * 1024 * 1024;

type Phase = "idle" | "uploading" | "starting";

/**
 * Build the kickoff prompt for an uploaded journal.
 *
 * The Shadow Account pipeline already exists as two agent tools
 * (`extract_shadow_strategy` → `run_shadow_backtest`). Rather than duplicate
 * that orchestration behind a bespoke HTTP route, this page uploads the file
 * and hands the agent an explicit plan referencing the stored path. The run
 * then streams into the normal Agent view with its tool timeline, artifacts,
 * and exports — all of which we would otherwise have to rebuild.
 *
 * The closing instruction about sample size is deliberate: these diagnostics
 * are easy to over-read on a short journal, and the agent should say so rather
 * than dress up noise as a behavioural finding.
 *
 * WORDING CONSTRAINT — do not casually reword this text. The grounding layer
 * scans the user message with _ACTIONABLE_MARKET_RE (agent/src/agent/grounding.py)
 * and, on a match, pins identity_status to "unresolved", which blocks
 * `load_skill` for the whole run. The model's recovery from that block is
 * nondeterministic: observed runs variously called the Shadow tools anyway,
 * refused the task outright, or silently downgraded to `analyze_trade_journal`
 * and skipped the backtest. So this prompt deliberately avoids the trigger
 * words — the standalone terms "trade", "buy", "sell", "entry", and the phrase
 * "price of" — in favour of "position", "open"/"close", and "dated rows".
 * `__tests__/shadowPrompt.test.ts` asserts this and will fail if it regresses.
 */
export function buildPrompt(filePath: string, fileName: string): string {
  return [
    `Analyse my trading journal. The broker export is at \`${filePath}\` (original filename: ${fileName}).`,
    "",
    "Follow these steps:",
    `1. Call \`extract_shadow_strategy\` with journal_path="${filePath}" to derive the rules I am implicitly trading.`,
    `2. Call \`run_shadow_backtest\` with the returned shadow_id and journal_path="${filePath}".`,
    "   Set `start` and `end` to the earliest and latest dated rows in the journal itself. This matters: the tool otherwise defaults to the last twelve months, which for a historical journal means running over a window the positions never touched — it returns nothing and the attribution figures become meaningless.",
    "",
    "Then report, with numbers:",
    "- **Behavioural profile** — holding days, win rate, profit/loss ratio, max drawdown, and explicit checks for disposition effect (cutting winners early, riding losers), overtrading, momentum chasing, and anchoring.",
    "- **The rules I actually follow** — the extracted open/close rules, stated plainly.",
    "- **Where I broke them** — rule breaks, early exits, and missed signals, each with the position and what it cost.",
    "- **The gap** — how the shadow strategy's performance compares with what I actually did, and where the difference came from.",
    "",
    "Be specific and quantitative. Where the sample is too small to support a conclusion, say so explicitly rather than reporting a number as if it were meaningful. If the shadow backtest returns nothing or empty metrics, say so plainly and do not present its attribution figures as findings.",
  ].join("\n");
}

export function ShadowAccount() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const busy = phase !== "idle";

  const validate = (file: File): string | null => {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXT.includes(ext as (typeof ACCEPTED_EXT)[number])) {
      return i18n.t("shadow.errUnsupported", {
        defaultValue: "Unsupported file type. Export your trades as CSV, TSV, or Excel.",
      });
    }
    if (file.size > MAX_BYTES) {
      return i18n.t("shadow.errTooLarge", { defaultValue: "File is larger than the 50 MB limit." });
    }
    if (file.size === 0) {
      return i18n.t("shadow.errEmpty", { defaultValue: "That file is empty." });
    }
    return null;
  };

  const analyse = async (file: File) => {
    const invalid = validate(file);
    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setFileName(file.name);
    setPhase("uploading");

    try {
      const { file_path } = await api.uploadFile(file);

      // Session is created before the message so the run has somewhere to
      // stream to; the title is what shows in the sidebar history.
      setPhase("starting");
      const session = await api.createSession(
        i18n.t("shadow.sessionTitle", {
          defaultValue: "Shadow Account — {{name}}",
          name: file.name,
        }),
      );
      await api.sendMessage(session.session_id, buildPrompt(file_path, file.name));

      // Hand off to the Agent view, which already renders streaming progress,
      // the tool timeline, and the resulting report.
      navigate(`/agent?session=${encodeURIComponent(session.session_id)}`);
    } catch (e) {
      setPhase("idle");
      setFileName(null);
      setError(
        e instanceof Error
          ? e.message
          : i18n.t("shadow.errFailed", { defaultValue: "Upload failed. Please try again." }),
      );
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void analyse(file);
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Fingerprint className="h-6 w-6 shrink-0 text-primary mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold">
            {i18n.t("shadow.title", { defaultValue: "Shadow Account" })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {i18n.t("shadow.subtitle", {
              defaultValue:
                "Upload your broker export. The agent profiles how you actually trade, extracts the rules you are really following, backtests them, and shows you the gap between the two.",
            })}
          </p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "relative rounded-xl border-2 border-dashed transition-colors",
          dragging ? "border-neon bg-primary/5" : "border-border",
          busy && "opacity-70",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXT.join(",")}
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so re-picking the same file fires onChange again.
            e.target.value = "";
            if (file) void analyse(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="pressable flex w-full flex-col items-center gap-3 px-6 py-14 text-center disabled:cursor-not-allowed"
        >
          {busy ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-neon" aria-hidden="true" />
              <span className="text-sm font-medium">
                {phase === "uploading"
                  ? i18n.t("shadow.uploading", { defaultValue: "Uploading {{name}}…", name: fileName })
                  : i18n.t("shadow.starting", { defaultValue: "Starting analysis…" })}
              </span>
            </>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">
                {i18n.t("shadow.dropHere", { defaultValue: "Drop your trade export here, or click to browse" })}
              </span>
              <span className="text-xs text-muted-foreground">
                {i18n.t("shadow.accepts", {
                  defaultValue: "CSV, TSV, or Excel · up to 50 MB · 同花顺, 东方财富, 富途, and generic formats",
                })}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm"
        >
          <TriangleAlert className="h-4 w-4 shrink-0 text-danger mt-0.5" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label={i18n.t("layout.cancel", { defaultValue: "Dismiss" })}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* What you get */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {i18n.t("shadow.whatYouGet", { defaultValue: "What the analysis returns" })}
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
          {[
            i18n.t("shadow.point1", {
              defaultValue:
                "Your behavioural profile — holding periods, win rate, and checks for disposition effect, overtrading, momentum chasing, and anchoring.",
            }),
            i18n.t("shadow.point2", {
              defaultValue: "The rules you are actually trading, extracted from recurring entries and exits.",
            }),
            i18n.t("shadow.point3", {
              defaultValue: "A backtest of those rules run cleanly, with no hesitation and no rule breaks.",
            }),
            i18n.t("shadow.point4", {
              defaultValue: "The gap: where your real trades diverged from your own strategy, and what it cost.",
            }),
          ].map((text, i) => (
            <li key={i} className="flex gap-2.5">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neon"
                aria-hidden="true"
              />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          {i18n.t("shadow.privacy", {
            defaultValue:
              "Your file is stored locally under ~/.vibe-trading and read by the agent on this machine. Journal contents are sent to your configured LLM provider as part of the analysis.",
          })}
        </p>
      </div>
    </div>
  );
}
