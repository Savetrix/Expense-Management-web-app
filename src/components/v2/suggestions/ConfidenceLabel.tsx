import { CONFIDENCE_LABEL, type Confidence } from "@/lib/suggestions/picks";

// How sure ScanTrix is about a suggestion (Smart Suggestions). Low is red so
// nobody takes it for a sure answer. Step 4's AI picks are always Low, and say
// so: "AI suggestion, please review" (`ai`).
const STYLE: Record<Confidence, string> = {
  high: "bg-success/10 text-text-primary",
  medium: "bg-warning/10 text-text-primary",
  low: "bg-error/10 font-bold text-error",
};

export function ConfidenceLabel({ level, ai = false, className = "" }: { level: Confidence; ai?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill px-[6px] py-[1px] text-[11px] font-semibold ${STYLE[ai ? "low" : level]} ${className}`}
      title={ai ? "An AI suggestion with nothing posted before behind it: please review" : level === "low" ? "Low confidence: please review" : `${CONFIDENCE_LABEL[level]} confidence`}
    >
      {ai ? `${CONFIDENCE_LABEL.low} · AI suggestion, please review` : CONFIDENCE_LABEL[level]}
    </span>
  );
}
