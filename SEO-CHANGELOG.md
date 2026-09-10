# SEO-CHANGELOG

Technical record of the SEO work. Companion to `SEO-AUDIT.md` (written for the
client); this one is for whoever reviews or extends the diff.

**Branch:** `seo` (cut from `main`). Committed locally; **not pushed**, and
`main` is untouched.
**Gate:** `npx tsc --noEmit && npx next build` — passes. `npm test` — 356/356.
**Next 16 conventions used here were read from `node_modules/next/dist/docs/`**
(`01-app/03-api-reference/03-file-conventions/01-metadata/{robots,sitemap,opengraph-image}.md`,
`04-functions/generate-metadata.md`, `01-app/02-guides/json-ld.md`) rather than
from memory, per `AGENTS.md`.

---

## 0. TL;DR

Every route served an empty `<body>`. Root cause was two client components in
the root layout that render nothing during SSR. Fixed by moving the signed-in
product into an `(app)` route group that owns those components, leaving `/`
rendering on the server. Then added the metadata layer that was entirely
absent: robots, sitemap, canonicals, OG/Twitter + generated image, JSON-LD,
noindex on private routes.

**No business logic, auth, data handling or QuickBooks code was modified.**
`AuthGate.tsx` was not edited at all. The 25 moved page files are byte-identical
(pure `git mv`).

---

## 1. Root cause — why every route rendered blank

Reproduced from the build output before any change:

```
$ python3 -c "...strip scripts+tags from .next/server/app/index.html..."
VISIBLE TEXT LEN: 55        # <title> only
h1 count: 0  h2 count: 0
```

Body was literally:

```html
<body class="min-h-full flex flex-col"><div hidden=""><!--$--><!--/$--></div><script …>
```

All 25 prerendered routes measured 0 characters of body text and 0 `<h1>`.

Two independent blockers, stacked:

1. **`src/app/providers.tsx:24`** — `<PersistGate loading={null}>`. redux-persist's
   `PersistGate` returns `this.props.loading` until `state.bootstrapped` is true.
   `bootstrapped` can only become true after a client-side storage read, so SSR
   always renders `null`.
2. **`src/components/auth/AuthGate.tsx:91`** — `if (restoring) return <FullScreenLoader />;`
   with `useState(true)`. Even past blocker 1, SSR would render the spinner, not
   children.

Both sat in the root layout, so they applied to `/` as well as the product.

### Why the fix is a route group and not a one-line change

Considered and rejected:

- **Hoisting `isRoot` above the `restoring` check in `AuthGate`.** Necessary but
  not sufficient — `PersistGate` still returns `null` above it. Also edits auth
  code.
- **Removing / loosening `PersistGate`'s gating.** That gate exists so the
  persisted `quickBooks` slice (`connected`, `realmId`, `qbConnectionId`,
  `hasExplicitSelection` — `src/store/index.ts:31-35`) is rehydrated before the
  product renders. Removing it risks a flash of stale connection state in the
  app. That is behaviour, not presentation. Out of scope.
- **Making `LandingPage` a Server Component.** Irrelevant while it is nested
  inside `PersistGate`; client components are already SSR'd to HTML.

The route group is the only option that gets `/` out from under both gates
without touching either.

---

## 2. Change 1 — `(app)` route group

### Moves (pure `git mv`, 25 files, no content change)

```
src/app/{accounting-software,dashboard,forgot-password,gl-tax-codes,google-drive,
         invite,invoices,login,paywall,plans,preferences,profile,quickbooks,
         register,subscription,team,vendors}
  → src/app/(app)/…
```

`src/app/api/` stays put. Route groups don't appear in URLs — **every public path
is unchanged**, confirmed against the build's route table (36 routes before and
after, same paths).

### New: `src/app/(app)/layout.tsx`

Owns what the root layout used to:

```tsx
<div className={`${geistMono.variable} flex min-h-full flex-1 flex-col`}>
  <Providers><AuthGate>{children}</AuthGate></Providers>
</div>
```

Also declares `metadata.robots = { index: false, follow: false }` once for the
whole group, instead of on 20-odd pages.

### Modified: `src/app/layout.tsx`

- Dropped `<Providers>` / `<AuthGate>`.
- Dropped `Geist_Mono` (moved to the `(app)` layout — see §7).
- Kept `<html>`, `<body>`, `Geist`, the Meta Pixel `<Script>` and the `<noscript>`
  pixel exactly as they were. Pixel behaviour is untouched.

### Modified: `src/app/not-found.tsx` — **read this one carefully**

The old file carried an explicit comment that it "Still passes through the root
layout (Providers > AuthGate), so an unauthenticated visitor gets AuthGate's
existing redirect-to-/login behavior for any non-public path exactly as it does
today", citing `DESIGN_ASSUMPTIONS.md D4.2`.

An unmatched URL resolves against the **root** layout, not the group's — so
removing the pair from the root layout would have silently dropped that
behaviour. `not-found.tsx` now re-applies `<Providers><AuthGate>` around its own
content, preserving D4.2 exactly.

Also in this file: the headline `<p class="text-h2">` became `<h1>`, and
`metadata.robots` is now `noindex, nofollow`.

### Verified

| | before | after |
|---|---|---|
| `/` body text | 0 chars | **12,497 chars** |
| `/` headings | 0 h1 / 0 h2 / 0 h3 | **1 / 12 / 34** |
| `/` `<a href>` | 0 | **22** |
| `/dashboard` body | `<div hidden>` shell | unchanged (still gated — correct) |
| `/nonexistent` | 404 | 404 |

---

## 3. Change 2 — `src/lib/seo.ts` (new)

Single source for the canonical origin and all structured data.

```ts
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://scantrix.ai")
  .replace(/\/$/, "");
```

Mirrors the `process.env.X || "<known-good>"` pattern from `src/lib/api.ts:8`, per
`AGENTS.md`. No browser-only calls in this module, so no `typeof window` guards
are needed — it's imported only from Server Components.

Exports: `SITE_URL`, `SITE_NAME`, `SUPPORT_EMAIL`, `absoluteUrl()`,
`jsonLdScriptProps()`, `organizationJsonLd`, `softwareApplicationJsonLd`,
`FAQ_ITEMS`, `faqPageJsonLd`.

`jsonLdScriptProps` escapes `<` to its unicode escape before injection, which is the
sanitisation Next's own JSON-LD guide prescribes (`JSON.stringify` does not
sanitise for `<script>` context).

**Sourcing discipline:** every factual value carries a code citation in a
comment. Two deliberate omissions:

- **No `offers` on `SoftwareApplication`.** The only price in the codebase is the
  trial's `$0`; Standard and Enterprise are `"Monthly / yearly"`
  (`LandingPage.tsx` `PLANS`) and the page defers to the app. Emitting a
  fabricated price would be worse than losing rich-result eligibility.
- **No `BreadcrumbList`.** One indexable URL means no hierarchy. A self-referential
  one-item trail is discarded by Google. Becomes valid when the sub-pages land.

---

## 4. Change 3 — metadata layer

### `src/app/layout.tsx`

```ts
metadataBase: new URL(SITE_URL),   // required before any relative metadata URL
title: { default: "…", template: "%s" },  // "%s" — pages already carry "— Scantrix"
openGraph: { type, siteName, locale: "en_US", url },
twitter:   { card: "summary_large_image" },
robots:    { index: true, follow: true, googleBot: { "max-image-preview": "large", … } },
```
plus `export const viewport: Viewport = { themeColor: "#1fb6aa" }`.

**No default `alternates.canonical`.** An inherited canonical would have pointed
every noindex app route at `/` — semantically "this page is the homepage". Was
briefly implemented that way, caught in verification, removed. Indexable pages
declare their own.

### `src/app/page.tsx`

- Title rewritten to lead with the category:
  `"QuickBooks Invoice Scanning & AP Automation | Scantrix"`.
- `alternates: { canonical: "/" }`.
- Renders the three JSON-LD blocks. **They are emitted from the Server Component
  wrapper, not from inside `LandingPage`** (which is `"use client"`) — so they
  land in the initial HTML, which is the only form crawlers parse.

### `src/app/robots.ts` (new)

`MetadataRoute.Robots`. Disallows `/api/` plus the 17 product path prefixes;
declares `Host` and the sitemap. Path prefixes are hardcoded rather than derived
from the route group, because route-group names never appear in URLs.

> **Maintenance note:** adding a route under `(app)/` does **not** automatically
> add it here. It will still be `noindex` from the group layout, but it won't be
> `Disallow`ed. Keep the list in sync.

### `src/app/sitemap.ts` (new)

One entry — `/`. Deliberately not padded with the noindex routes.

### `src/app/opengraph-image.tsx` (new)

`next/og` `ImageResponse`, 1200×630, generated at build time. System font stack
only, so the build makes no network call. Satori constraints observed (explicit
`display: flex` on every multi-child element). Applies to `/` and is inherited
by the routes below it, so shared app links also get a card.

Verified: `image/png`, 1200×630, 93,596 bytes; rendered output visually checked.

---

## 5. Change 4 — landing page content

### FAQ section (`LandingPage.tsx`, new `Faq()` between `<About />` and `<FinalCta />`)

- Renders from `FAQ_ITEMS` in `@/lib/seo` — **the same array `faqPageJsonLd` is
  built from.** One source, deliberately: Google only credits FAQ markup whose
  answers are visible on the page, so drift would silently invalidate it.
- Native `<details>`/`<summary>`. No hydration needed, all seven answers in the
  server HTML whether expanded or not, native keyboard/AT semantics.
- `<h2>` for the section, `<h3>` per question — fits the existing hierarchy.
- Added `#faq` to `LandingNav.tsx` `LINKS` and to the footer link row.

Every answer traces to existing copy or verified behaviour (email-security
answer ← `src/lib/inboundEmail/{authorization,authResults,scanVerdict,attachment}.ts`;
auto-post answer ← `invoiceSlice.ts:253-262` + `quickBooksSlice.ts:98`).

### `src/app/globals.css`

```css
@media (scripting: none) {
  .lp-reveal { opacity: 1; transform: none; }
}
```

`.lp-reveal` is `opacity: 0` until an IntersectionObserver adds `.is-visible`
(`primitives.tsx:53-65`). Without JS nothing below the fold ever became visible.
Animation for JS users is unchanged.

---

## 6. Change 5 — `.env.local.example`

Documents `NEXT_PUBLIC_SITE_URL` (default `https://scantrix.ai`). Note in the
file warns that pointing it at a staging host puts that host in the sitemap.

---

## 7. Font change — worth a second look in review

`Geist_Mono` moved from the root layout to `(app)/layout.tsx`. It is only ever
rendered by `src/components/accounting/EmailForwardingPanel.tsx:171,177,259`, an
authenticated panel, but was preloaded on every marketing visit.

The variable now lands on a wrapper `<div>` inside `<body>` instead of `<html>`;
`--font-mono` in `globals.css:81` picks it up by inheritance.

Verified in the served HTML:

- `/` → **one** font preload (Geist Sans).
- `/dashboard` → two, and
  `class="geist_mono_…__variable flex min-h-full flex-1 flex-col"` present.

If anyone later renders `font-mono` **outside** the `(app)` group, they must
re-declare the font there.

---

## 8. Verification performed

```
npx tsc --noEmit                → clean
npx next build                  → exit 0, 36 routes
npm test                        → 356 pass / 0 fail
npx next start -p 3111          → live checks below
```

| Route | Status | Result |
|---|---|---|
| `/` | 200 | 137,466 B; 12,497 chars text; canonical `https://scantrix.ai`; `index, follow`; **3** `<script type="application/ld+json">` elements, all valid JSON (`Organization`, `SoftwareApplication`, `FAQPage` with 7 questions) |
| `/robots.txt` | 200 | `text/plain`, 469 B, correct disallows + sitemap |
| `/sitemap.xml` | 200 | `application/xml`, valid urlset |
| `/opengraph-image` | 200 | `image/png` 1200×630 |
| `/dashboard` | 200 | `noindex, nofollow`; **no** canonical; gated shell unchanged |
| `/login` | 200 | `noindex, nofollow` |
| `/nope` | 404 | renders the 404 |

> A stale `.next/dev/types/validator.ts` from a previous dev server made `tsc`
> report ~20 phantom `TS2307`s against the pre-move paths. It is generated
> output. `rm -rf .next/dev/types .next/types tsconfig.tsbuildinfo` and rebuild.
> Anyone with a dev server running during the move will hit this once.

---

## 9. File inventory

**Added (6)**
```
src/app/(app)/layout.tsx        gates + mono font + group-wide noindex
src/app/opengraph-image.tsx     1200×630 build-time OG/Twitter card
src/app/robots.ts               crawl directives + sitemap pointer
src/app/sitemap.ts              indexable URL set
src/lib/seo.ts                  SITE_URL, JSON-LD payloads, FAQ_ITEMS
SEO-AUDIT.md                    client deliverable
```

**Modified (7)**
```
src/app/layout.tsx                      gates+mono removed; metadataBase/OG/twitter/robots/viewport added
src/app/page.tsx                        category-led title, canonical, 3 JSON-LD blocks
src/app/not-found.tsx                   re-applies gates (D4.2); <p> → <h1>; noindex
src/app/globals.css                     @media (scripting: none) reveal fallback
src/components/landing/LandingPage.tsx  Faq() section, FAQ_ITEMS import, Plus icon, footer #faq
src/components/landing/LandingNav.tsx   #faq nav link
.env.local.example                      NEXT_PUBLIC_SITE_URL
```

**Moved (25)** — `git mv` only, contents unchanged: all `src/app/<route>/page.tsx`
→ `src/app/(app)/<route>/page.tsx`.

Net on non-moved files: **+581 / −41** across 12 files.

---

## 10. Not done, and why

- **`DashboardContent.tsx` heading order** (h2 + two h4, no h1). Accessibility
  only; the route is noindex. Editing product markup was outside scope.
- **`BreadcrumbList`** — invalid with one indexable URL. See §3.
- **`SoftwareApplication.offers`** — no verifiable price in the codebase. See §3.
- **New marketing pages** (`/quickbooks-integration`, `/features/email-forwarding`,
  `/features/claude-connector`, comparison pages). New page copy is explicitly a
  client decision; see `SEO-AUDIT.md` §6, open question 2.
- **Meta Pixel** left exactly as-is. `afterInteractive` is already non-blocking;
  moving or removing it is an ads decision.
- **The three copy/code contradictions** (duplicate-invoice catching, vendor
  near-duplicate merge, the "Which vendors are duplicates?" assistant prompt).
  Flagged in `SEO-AUDIT.md` §3, not silently edited. **Item 1 involves a claim
  that `BACKEND_duplicate-bills.md` documents as an open customer-reported
  defect — it needs a decision before the next marketing push, independent of
  anything SEO.**
