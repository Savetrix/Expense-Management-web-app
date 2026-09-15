interface ProgressBarProps {
  /** 0-100. Clamped internally so bad upstream data can't overflow the track. */
  percent: number;
  colorClassName?: string;
  label?: string;
}

// Thin horizontal track + colored fill, used for the vendor-spend bars on
// dashboard/invoices in the Stitch export. Pure CSS, no chart library — same
// approach the mockups use.
export function ProgressBar({ percent, colorClassName = "bg-chart-1", label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-[var(--space-sm)]">
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 flex-1 overflow-hidden rounded-pill bg-chart-4"
      >
        <div className={`h-full rounded-pill transition-[width] ${colorClassName}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
