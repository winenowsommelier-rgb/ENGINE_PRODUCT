import { parseCriticScores } from "@/lib/explore/critic-score";

export interface CriticScoreBadgeProps {
  scoreMax?: number | null;
  scoreSummary?: string | null;
  variant: "detail" | "compact";
  theme?: "dark" | "light";
  maxCritics?: number;
}

export function CriticScoreBadge({
  scoreMax,
  scoreSummary,
  variant,
  theme = "dark",
  maxCritics = 4,
}: CriticScoreBadgeProps) {
  const parsed = parseCriticScores(scoreMax, scoreSummary, maxCritics);
  if (!parsed) return null; // render-nothing contract
  const light = theme === "light";

  if (variant === "compact") {
    // Inline chip for the list-grid badges row. Lead score + abbr + "+N".
    return (
      <span
        aria-label={parsed.ariaLabel}
        title={parsed.ariaLabel}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums border ${
          light
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : "bg-amber-500/15 text-amber-300 border-amber-500/25"
        }`}
      >
        <span className="font-bold">{parsed.lead.score_native}</span>
        <span className="opacity-80">{parsed.lead.abbr}</span>
        {parsed.overflow > 0 && (
          <span className={light ? "text-amber-600" : "text-amber-300/70"}>
            +{parsed.overflow}
          </span>
        )}
      </span>
    );
  }

  // variant === "detail" — segmented data strip.
  // Guarantee the lead is shown even if it ranks below the maxCritics cap.
  const cells = parsed.critics.some(
    (c) => c.abbr === parsed.lead.abbr && c.score_value === parsed.lead.score_value,
  )
    ? parsed.critics
    : [parsed.lead, ...parsed.critics.slice(0, Math.max(0, parsed.critics.length - 1))];

  return (
    <div role="group" aria-label={parsed.ariaLabel}>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-slate-500">
        Critic Scores
      </p>
      <div
        className={`inline-flex items-stretch rounded-[10px] overflow-hidden tabular-nums border ${
          light ? "bg-white border-slate-200" : "bg-white/[0.03] border-white/10"
        }`}
      >
        {cells.map((c, i) => {
          const isLead =
            c.abbr === parsed.lead.abbr && c.score_value === parsed.lead.score_value;
          const divider = light ? "border-slate-200" : "border-white/[0.08]";
          const leadBg = isLead
            ? light
              ? "bg-gradient-to-b from-amber-50 to-white"
              : "bg-gradient-to-b from-amber-500/[0.16] to-amber-500/[0.05]"
            : "";
          return (
            <div
              key={`${c.abbr}-${i}`}
              className={`flex flex-col gap-0.5 px-3.5 py-2 min-w-[54px] ${leadBg} ${
                i < cells.length - 1 ? `border-r ${divider}` : ""
              }`}
            >
              <span
                className={`text-[9px] font-bold uppercase tracking-wide ${
                  isLead
                    ? light
                      ? "text-amber-700"
                      : "text-amber-300"
                    : light
                    ? "text-slate-400"
                    : "text-slate-500"
                }`}
              >
                {c.abbr}
              </span>
              <span
                className={`text-base font-bold leading-none ${
                  isLead
                    ? light
                      ? "text-amber-800"
                      : "text-amber-100"
                    : light
                    ? "text-slate-800"
                    : "text-slate-100"
                }`}
              >
                {c.score_native}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
