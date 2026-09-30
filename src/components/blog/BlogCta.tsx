import { ArrowRight, ShieldCheck } from "lucide-react";

import { SignupLink } from "./SignupLink";

/** The end-of-article call to action. Claims mirror the homepage's final CTA. */
export function BlogCta() {
  return (
    <aside
      aria-label="Try Scantrix"
      className="relative overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-10"
      style={{ background: "linear-gradient(165deg, var(--lp-navy) 0%, var(--lp-navy-950) 100%)" }}
    >
      <div className="lp-dotgrid-light pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-pill border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white/80">
          <ShieldCheck size={14} className="text-[color:var(--lp-teal)]" aria-hidden /> 14-day free trial · No credit card
        </span>
        <p className="mt-5 text-[clamp(1.4rem,3vw,1.9rem)] font-bold leading-tight tracking-[-0.02em] text-white">
          Stop typing invoices into QuickBooks.
        </p>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-white/70">
          Scantrix reads your supplier invoices, matches the vendors and posts the
          bills, and holds anything uncertain for a quick human check.
        </p>
        <SignupLink className="group mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-7 text-[15px] font-semibold text-[color:var(--lp-navy)] shadow-lg transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--lp-navy)]">
          Start free — 14 days
          <ArrowRight size={17} strokeWidth={2.25} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
        </SignupLink>
      </div>
    </aside>
  );
}
