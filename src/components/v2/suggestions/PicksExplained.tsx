import { formatPlainDate } from "@/lib/plainDate";
import { isPrior, PRIOR, type PickStep, type SuggestionPick } from "@/lib/suggestions/picks";

import { ConfidenceLabel } from "./ConfidenceLabel";

// "How ScanTrix decided", step 2: which step found each of the top 3
// accounts, and the past items each one is based on. An item read from the
// company's books shows only its name and "From prior classifications": no
// date, no source (Saurabh, 20 Nov).

const STEP_LABEL: Record<PickStep, string> = {
  history: "Same vendor or payee before",
  vendor_default: "Vendor default",
  similar: "Similar past items",
  ai: "AI suggestion, please review",
};

const money = (cents: number | null) =>
  cents === null ? null : (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PicksExplained({ picks }: { picks: { pick: SuggestionPick; name: string; reason: string }[] }) {
  if (picks.length === 0) return null;
  return (
    <ol className="flex flex-col gap-[var(--space-xs)]">
      {picks.map(({ pick, name, reason }, i) => (
        <li key={pick.glAccountId} className="rounded-md border border-border bg-surface px-[var(--space-sm)] py-[var(--space-xs)]">
          <p className="flex flex-wrap items-center gap-[var(--space-xs)] text-caption text-content-primary">
            <span className="font-bold">
              {i + 1}. {name}
            </span>
            <ConfidenceLabel level={pick.confidence} />
            <span className="text-content-secondary">· {STEP_LABEL[pick.step]}</span>
          </p>
          <p className="text-caption text-content-secondary">{reason}.</p>
          {pick.evidence.length > 0 && (
            <ul className="mt-[2px] text-[11px] text-content-secondary">
              {pick.evidence.map((e, j) => (
                <li key={`${e.date}-${j}`}>
                  {(isPrior(e)
                    ? [e.label, PRIOR.toLowerCase()]
                    : [e.label, formatPlainDate(e.date, { day: "numeric", month: "short", year: "numeric" }), money(e.amountCents), e.source === "invoice" ? "bill" : "bank line"]
                  )
                    .filter(Boolean)
                    .join(" · ")}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
