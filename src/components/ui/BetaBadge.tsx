// Solid amber with near-black text (~9:1) so it stays legible on both light and
// dark surfaces, unlike the tinted Badge variants.
export function BetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill bg-[#F59E0B] px-[var(--space-sm)] py-[2px] text-tiny font-bold uppercase tracking-[0.08em] text-[#1a1a1a] ${className}`}
    >
      Beta
    </span>
  );
}
