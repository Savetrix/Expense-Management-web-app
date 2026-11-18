# Landing Page — Design Brief

> Overrides MASTER.md for the marketing landing route (`/`). Uses the **real**
> app tokens from `src/app/globals.css` (teal `#1fb6aa` primary + navy
> `#1f3a5f` trust), not MASTER.md's stale navy/green palette.

## Research insights (best-in-class fintech / dev-tool landing pages)

Studied the underlying principles behind Stripe, Linear, Ramp, Mercury, Vercel,
Retool. What makes them read as *premium* rather than *template*:

1. **Confidence through restraint.** One accent color, deep neutrals, huge
   whitespace, a strong typographic hero. No rainbow gradients, no floating
   glass blobs, no icon-grid soup. Applied here: teal is the *only* accent;
   navy carries depth; everything else is neutral.
2. **The product is the hero.** The best pages show the actual UI — layered,
   annotated, alive — instead of stock art. We recreate real ScanTrix screens
   (extraction, dashboard summary cards, QuickBooks post) as in-browser
   mockups. Every pixel maps to something the app genuinely does.
3. **One signature motion moment.** Stripe/Linear anchor the hero on a single
   animated demonstration of the core value. Ours: an invoice being *read*
   (scan sweep → fields populate → status flips to "Posted to QuickBooks").
4. **Depth via layering, not decoration.** Fine 1px borders, real elevation
   tokens, a soft ambient teal glow behind product mockups, a faint dot grid.
5. **Editorial rhythm.** Small tracked-out uppercase section labels, generous
   vertical spacing, alternating light/soft/dark bands to pace the scroll.
6. **Honesty as a trust signal.** No invented customer logos or fake metrics.
   Proof = the real QuickBooks integration + the real product behavior.

## Messaging hierarchy

1. **What it is:** ScanTrix reads your invoices and posts them to QuickBooks.
2. **Who it's for:** Accountants and small-business finance teams.
3. **Problem:** Manual accounts-payable — retyping invoices into QuickBooks,
   matching vendors by hand, month-end pileups, error-prone data entry.
4. **Outcome:** Invoices become posted QuickBooks bills automatically; you only
   touch the ones that need a human.
5. **Why different:** Not generic OCR. Extraction → vendor resolution →
   auto-post *directly into QuickBooks*, with multi-company support and a
   review queue for exceptions.
6. **Next step:** Start free — 14-day trial (real). Secondary: Log in.

Hero headline direction: **"Your invoices, posted to QuickBooks — automatically."**
Concrete, outcome-first, matches in-product language. Avoids the banned
"revolutionize / unlock / seamless / transform / next-generation" clichés.

## Visual system (derived from app tokens)

- **Canvas:** white `#ffffff` / soft `#f8fafc` / alt `#f7f8fa`, alternating.
- **Ink:** text-primary `#0f172a`, secondary `#475569`.
- **Accent:** teal `#1fb6aa` (glows, scan line, active data, links, highlights).
- **Depth:** trust-navy `#1f3a5f`; deepened shades for dark editorial bands.
- **Status (reused verbatim from `invoiceDisplay.ts`):** auto `#21A77A`,
  manual `#EDA320`, pending navy `#1F3A5F`, failed `#E74949`.
- **CTA contrast rule (critical):** white-on-teal fails WCAG AA (2.52:1). So the
  **primary CTA is navy fill + white text**; teal is accent only. Mirrors the
  app's own Button contract (`Button.tsx` D2.3).
- **Type:** Geist (the app font) — large display sizes, tight tracking for the
  editorial feel. No new font dependency.
- **Icons:** lucide-react (already a dep); QuickBooks mark via simple-icons
  `BrandIcon` (already used in the shell).
- **Motion:** IntersectionObserver scroll-reveals + CSS keyframes only (no new
  dependency). All motion gated behind `prefers-reduced-motion`.

## Narrative structure

Nav → Hero (animated extraction) → Integration/trust strip → Problem →
How it works (3 steps, real mini-mockups) → Core capabilities (outcome-framed) →
Dashboard showcase (real summary cards) → Differentiation (vs. manual entry) →
Pricing (real trial + real plan differences, live pricing in-app) →
Final CTA → Footer.
