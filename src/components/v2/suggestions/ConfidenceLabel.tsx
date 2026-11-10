import { CONFIDENCE_LABEL, type Confidence } from "@/lib/suggestions/picks";

// How sure Scantrix is about a suggestion (Smart Suggestions). Low is red so
// nobody takes it for a sure answer; step 4's AI picks will always be Low.
const STYLE: Record<Confidence, string> = {
  high: "bg-success/10 text-text-primary",
  medium: "bg-warning/10 text-text-primary",
  low: "bg-error/10 font-bold text-error",
};

export function ConfidenceLabel({ level, className = "" }: { level: Confidence; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill px-[6px] py-[1px] text-[11px] font-semibold ${STYLE[level]} ${className}`}
      title={level === "low" ? "Low confidence: please review" : `${CONFIDENCE_LABEL[level]} confidence`}
    >
      {CONFIDENCE_LABEL[level]}
    </span>
  );
}
