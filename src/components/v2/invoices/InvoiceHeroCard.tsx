"use client";

import { AlertTriangle, Building2 } from "lucide-react";
import { ReactNode, useState } from "react";

import { Badge } from "@/components/ui/Badge";

// r chosen so the circle's circumference is exactly 100 (2πr ≈ 100) — lets
// stroke-dasharray/stroke-dashoffset values be plain percentages instead of
// arc-length math.
const RING_RADIUS = 15.9155;
const RING_STROKE_WIDTH = 3;

// Shared by every screen that shows a confidence score — colorClass sets the
// ring's stroke via currentColor, so it always matches that screen's own
// theme (InvoiceReviewContentV2 colors by confidence tier, InvoiceDetailContentV2
// by postedStatus — same ring, different color source).
export function ConfidenceRing({ percent, colorClass }: { percent: number; colorClass: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        <circle cx="18" cy="18" r={RING_RADIUS} fill="none" className="stroke-border" strokeWidth={RING_STROKE_WIDTH} />
        <circle
          cx="18"
          cy="18"
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE_WIDTH}
          strokeDasharray={`${clamped} ${100 - clamped}`}
          strokeLinecap="round"
          pathLength={100}
          className={colorClass}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-caption font-extrabold ${colorClass}`}>{Math.round(clamped)}%</span>
        <span className="text-[9px] font-semibold text-content-secondary">conf.</span>
      </div>
    </div>
  );
}

export interface InvoiceHeroReason {
  /** e.g. "Why this requires review" / "Why this failed". */
  title: string;
  message: string;
  isTranslated: boolean;
  raw: string;
  showTechnicalReason: boolean;
  onToggleTechnicalReason: () => void;
}

interface InvoiceHeroCardProps {
  themeClasses: { bg: string; border: string; text: string };
  badgeVariant: "success" | "warning" | "error" | "neutral";
  badgeLabel: string;
  /** null hides the confidence pill, ring, and the "?" info button entirely. */
  confidenceScore: number | null;
  realmId?: string | null;
  vendorName: string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  totalAmountDisplay: string;
  reason?: InvoiceHeroReason | null;
  /** Extra content rendered inside the reason box, below the message — e.g.
   *  InvoiceReviewContentV2's "+ Resolve Vendor" prompt. Only meaningful
   *  alongside `reason` (same box), so it's a no-op without one. */
  reasonExtra?: ReactNode;
}

// Single shared hero card — same badge/confidence/vendor/total/reason layout
// on every invoice screen (pending review, edit, and read-only detail),
// so pending/auto/manual/failed all read as one consistent design instead of
// each screen having drifted its own variant (a ring here, a bar there, a
// reason box with a heading here, without one there).
export function InvoiceHeroCard({
  themeClasses,
  badgeVariant,
  badgeLabel,
  confidenceScore,
  realmId,
  vendorName,
  invoiceNumber,
  invoiceDate,
  dueDate,
  totalAmountDisplay,
  reason,
  reasonExtra,
}: InvoiceHeroCardProps) {
  const [showConfidenceInfo, setShowConfidenceInfo] = useState(false);
  const hasConfidence = confidenceScore !== null;

  return (
    <>
      <div className={`relative overflow-hidden rounded-2xl border p-[var(--space-lg)] ${themeClasses.bg} ${themeClasses.border}`}>
        {hasConfidence && (
          <button
            type="button"
            onClick={() => setShowConfidenceInfo(true)}
            aria-label="How is this score calculated?"
            className={`absolute right-[var(--space-md)] top-[var(--space-md)] flex h-8 w-8 items-center justify-center rounded-full bg-surface font-extrabold shadow-sm ${themeClasses.text}`}
          >
            ?
          </button>
        )}

        <div className={`mb-[var(--space-md)] flex flex-wrap items-center gap-[var(--space-xs)] ${hasConfidence ? "pr-10" : ""}`}>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
          {hasConfidence && (
            <span className={`rounded-pill bg-surface px-[var(--space-sm)] py-1 text-caption font-semibold ${themeClasses.text}`}>
              {Math.round(confidenceScore)}% confidence
            </span>
          )}
          {realmId && (
            <span className="rounded-pill bg-surface px-[var(--space-sm)] py-1 text-caption font-semibold text-content-secondary">
              QBO Realm: {realmId}
            </span>
          )}
        </div>

        <div className="flex items-start justify-between gap-[var(--space-md)]">
          <div className="flex min-w-0 items-start gap-[var(--space-sm)]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-nav-bg text-nav-text-active">
              <Building2 size={22} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-h2 font-extrabold text-content-primary">{vendorName}</p>
              {invoiceNumber && <p className="text-body-sm font-semibold text-content-secondary">Invoice #{invoiceNumber}</p>}
              {invoiceDate && (
                <p className="text-caption text-content-secondary">
                  Date: {invoiceDate}
                  {dueDate && ` · Due: ${dueDate}`}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-[var(--space-sm)]">
            <div className="text-right">
              <p className="text-tiny font-bold uppercase tracking-wider text-content-secondary">Total Amount</p>
              <p className="text-h1 font-black tracking-tight text-content-primary">{totalAmountDisplay}</p>
            </div>
            {hasConfidence && <ConfidenceRing percent={confidenceScore} colorClass={themeClasses.text} />}
          </div>
        </div>

        {reason && (
          <div className="mt-[var(--space-md)] rounded-md bg-surface p-[var(--space-sm)]">
            <div className="flex items-start gap-[var(--space-xs)]">
              <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-status-danger-text" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-content-primary">{reason.title}</p>
                <p className="mt-1 text-body-sm font-medium text-status-danger-text">{reason.message}</p>
                {reason.isTranslated && (
                  <>
                    <button
                      type="button"
                      onClick={reason.onToggleTechnicalReason}
                      className="mt-1 text-caption font-semibold text-content-secondary underline"
                    >
                      {reason.showTechnicalReason ? "Hide technical details" : "Show technical details"}
                    </button>
                    {reason.showTechnicalReason && (
                      <p className="mt-1 break-words text-caption text-content-secondary">{reason.raw}</p>
                    )}
                  </>
                )}
              </div>
            </div>
            {reasonExtra}
          </div>
        )}
      </div>

      {showConfidenceInfo && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/45 p-[var(--space-lg)]"
          onClick={() => setShowConfidenceInfo(false)}
        >
          <div className="w-full max-w-md cursor-auto rounded-2xl bg-surface p-[var(--space-lg)]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-h3 font-extrabold text-content-primary">Confidence Score</h2>
            <p className="mt-[var(--space-sm)] text-body-sm text-content-secondary">
              This score reflects how confident Scantrix is in the data extracted from your scanned invoice — things
              like the vendor, amounts, and invoice number.
            </p>
            <p className="mt-[var(--space-md)] rounded-md bg-surface-alt p-[var(--space-sm)] text-center text-caption text-content-secondary">
              Higher confidence scores indicate greater accuracy of extracted invoice data and require less manual
              review. If a field looks off, you can always correct it below before posting.
            </p>
            <button
              type="button"
              onClick={() => setShowConfidenceInfo(false)}
              className="mt-[var(--space-md)] h-12 w-full rounded-md bg-accent font-bold text-accent-ink hover:bg-accent-hover"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
