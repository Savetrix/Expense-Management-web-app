import type { ReactNode } from "react";

// The small uppercase section label the blog index uses. The only piece left of
// the pre-redesign landing primitives; the homepage itself no longer uses it.
export function SectionLabel({
  children,
  tone = "teal",
  className = "",
}: {
  children: ReactNode;
  tone?: "teal" | "light";
  className?: string;
}) {
  const color = tone === "light" ? "text-[color:var(--lp-teal)]" : "text-[color:var(--lp-teal-700)]";
  return (
    <span
      className={`inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.18em] ${color} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--lp-teal)]" aria-hidden />
      {children}
    </span>
  );
}
