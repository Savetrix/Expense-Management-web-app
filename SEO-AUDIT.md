# Scantrix — Technical SEO Audit

**Site:** https://scantrix.ai
**Primary market:** United States and Canada
**Audited:** 9 September 2026
**Scope:** Full read of the application repository — every route, component and
library file — plus the HTML the server actually sends to a crawler.

A note on numbers: this audit contains no search volumes, keyword difficulty
scores or traffic forecasts. No keyword tool was available for this engagement,
and an invented number is worse than none. Every place a figure would normally
appear is marked **requires Ahrefs/SEMrush verification**. Nothing here promises
a ranking position; search engines do not sell those and nobody can guarantee
them. What is claimed is mechanism: what was broken, what it prevented, and what
now works.

---

## 1. Executive summary

- **Search engines were being served a blank page.** Not a thin page — a blank
  one. Every one of the site's 25 addresses returned a valid response
  containing zero words, zero headings and zero links. The marketing copy
  existed only after a visitor's browser ran JavaScript. This has been fixed:
  the homepage now delivers 12,497 characters of real text, one H1, twelve H2s
  and 34 H3s before a single line of JavaScript runs.

- **The site was invisible to everything except Google.** Google can run
  JavaScript, slowly and on a delay. LinkedIn, Slack, X, Facebook, Bing and the
  AI assistants people increasingly ask for software recommendations cannot.
  For all of them, scantrix.ai was an empty document.

- **None of the standard signals were present.** No robots.txt, no sitemap, no
  canonical tags, no social preview image, no structured data. Twenty-four of
  the 25 pages shared one identical description. All are now in place.

- **The private application was open to indexing.** Around twenty signed-in
  screens — dashboard, invoices, vendors, team, billing — returned a normal
  "come and index me" response. They are now explicitly excluded, both in
  robots.txt and in the pages themselves.

- **There is still only one page worth ranking.** Every fix above makes that one
  page work properly. It cannot, by itself, rank for the range of things an
  accountant searches. The next move is a small set of additional pages, and
  that needs your sign-off on copy — see section 5.

---

## 2. What we found

Severity reflects commercial consequence, not technical difficulty.

### 2.1 Critical

| # | Defect | Where | What it cost the business |
|---|--------|-------|---------------------------|
| 1 | **Every page served an empty body.** The whole site was wrapped in two components that render nothing until a browser rehydrates, so the server's response contained a placeholder and nothing else. Confirmed by reading the built output: 0 characters of text, 0 `<h1>` tags, on all 25 routes. | `src/app/layout.tsx:67-71` wrapping `src/app/providers.tsx:22-28` (`PersistGate` with `loading={null}`) and `src/components/auth/AuthGate.tsx:91` (`if (restoring) return <FullScreenLoader />`) | Google indexes JavaScript sites on a second, slower pass, so new or changed pages take materially longer to appear. Everything else that reads a link — LinkedIn, Slack, X, Facebook, Bing, and AI assistants — never runs JavaScript at all, so they saw nothing. A founder posting the link on LinkedIn was posting a blank page. |
| 2 | **No robots.txt.** | absent | Crawlers had no instruction about what to spend their time on, and no pointer to a sitemap. Crawl effort went into signed-in screens instead of the marketing page. |
| 3 | **No sitemap.xml.** | absent | No reliable way to tell Google the site's pages exist or when they changed. Discovery was left to chance. |

### 2.2 High

| # | Defect | Where | What it cost the business |
|---|--------|-------|---------------------------|
| 4 | **No canonical tags on any page.** | all 25 routes | When the same page is reachable at more than one address — with a tracking parameter on an ad click, with and without `www` — search engines have to guess which is the real one. Ad-campaign traffic is the common way this bites: every distinct `?utm_...` link can be treated as a separate page, splitting the page's accumulated credit. |
| 5 | **No Open Graph or Twitter Card tags, and no preview image.** | absent from `src/app/layout.tsx` | Every link anyone shared — in a LinkedIn post, a Slack channel, a sales email, a WhatsApp message to a prospect — rendered as a bare grey URL with no title, no description and no image. For a B2B product sold partly through founder and network sharing, this suppresses click-through on the highest-intent traffic there is. |
| 6 | **Twenty-four of 25 pages shared one identical meta description.** Only the homepage had its own. | `src/app/layout.tsx:20-22`; only `src/app/page.tsx:11-13` overrode it | Duplicate descriptions are a signal of a low-effort site, and they mean the search result snippet does not match what the searcher asked for. |
| 7 | **The signed-in application was indexable.** Roughly twenty authenticated screens returned HTTP 200 with no instruction against indexing. | `/dashboard`, `/invoices`, `/vendors`, `/team`, `/profile`, `/subscription`, `/preferences`, `/gl-tax-codes`, `/plans`, `/paywall` and others | Two costs. Crawl effort was spent fetching twenty near-identical empty pages instead of the one page that sells. And a search for "Scantrix" could surface a blank *Dashboard* result — the worst possible first impression for a prospect. |

### 2.3 Medium

| # | Defect | Where | What it cost the business |
|---|--------|-------|---------------------------|
| 8 | **No structured data of any kind.** | absent | Structured data is how a search engine learns, without guessing, that Scantrix is a software product, who publishes it, and what it answers. It is also increasingly how AI assistants decide what to cite when someone asks them to recommend AP software. |
| 9 | **Only one indexable page exists, and the navigation is entirely internal anchors.** The menu links to `#how`, `#pricing`, `#about`; the only genuine links are to Log in and Sign up. | `src/components/landing/LandingNav.tsx:10-17`; footer in `src/components/landing/LandingPage.tsx` | One page cannot be the best answer to "QuickBooks invoice scanning", "Dext alternative" and "how do I stop typing bills into QuickBooks" simultaneously. Each of those is a different searcher at a different stage. This is the single largest remaining constraint. |
| 10 | **Everything below the opening screen was invisible without JavaScript.** Sections were set to zero opacity and only faded in when scrolled into view. | `src/app/globals.css:126-133`; `src/components/landing/primitives.tsx:53-65` | On top of defect 1, even a crawler that did render the page saw content that depended on a scroll event to become visible. |

### 2.4 Low

| # | Defect | Where | Note |
|---|--------|-------|------|
| 11 | An unused font file was downloaded on every marketing visit. Geist Mono was loaded site-wide but only ever displayed inside a signed-in diagnostics panel. | declared `src/app/layout.tsx:13-16`; used only in `src/components/accounting/EmailForwardingPanel.tsx:171,177,259` | One wasted font download in the critical path of the page that matters most. |
| 12 | No `metadataBase` configured. | `src/app/layout.tsx` | Meant no metadata field could use a relative URL, which is why canonicals and social tags could not simply be added. |
| 13 | No `theme-color`, no viewport export. | `src/app/layout.tsx` | Cosmetic; affects mobile browser chrome. |
| 14 | The 404 page's headline was a styled paragraph, not a heading. | `src/app/not-found.tsx:17` (before) | Accessibility rather than ranking. |
| 15 | The dashboard has an H2 and two H4s but no H1. | `src/components/dashboard/DashboardContent.tsx` | Accessibility only — the page is correctly not indexed. **Left unfixed:** it is inside the product, and changing product markup is outside this engagement's scope. |

### 2.5 Things that were already right

Worth recording, because they are the reason this audit could focus on structure:

- Per-page titles existed on all 25 routes and were sensible.
- Heading order on the landing page was already correct — exactly one H1, sections in H2, cards in H3.
- No marketing copy was trapped in images or PDFs. The product mockups on the
  homepage are built from live HTML (`src/components/landing/mockups.tsx`), so
  every word in them is readable text.
- Fonts are self-hosted through the framework rather than fetched from Google's
  servers, which is both faster and better for privacy.
- The tracking pixel is loaded in a non-blocking way and does not delay the page.
- `lang="en"` is correctly set.

---

## 3. Contradictions to resolve before this is presented

These are places where the marketing copy states something the code does not
support. They are flagged rather than fixed, because deciding what to do is a
business call, not an engineering one. **All three are live on the site now.**

**A. The duplicate-invoice claim contradicts a known open defect.**
The homepage says Scantrix catches an invoice you have already paid — "Same
vendor, same invoice number, second time around — flagged before it posts, not
after the payment run" (`src/components/landing/LandingPage.tsx:525-526`).
The repository's own backend ticket says the opposite. `BACKEND_duplicate-bills.md`
opens by describing two customer reports of exactly this failure, states there
is "no dedupe key on the bill", and lists "Refuse to create a second bill for
the same (connection, vendor, invoice number)" as an **outstanding request to
the backend team**, not a shipped feature. The guard that does exist in this
repository (`src/store/invoice/invoiceApi.ts:205-285`) prevents re-posting *the
same invoice record twice* — a different and narrower thing than recognising
the same bill arriving a second time.
*This is the highest-risk item in the audit: it is a purchasing-decision claim,
in a financial product, that the team's own ticket documents as unfixed.*

**B. Vendor de-duplication is advertised but not implemented.**
The homepage says Scantrix "Spots the near-duplicates that accumulate over
years… and suggests the merge" (`LandingPage.tsx:544`). The suggestion engine
(`src/components/vendors/VendorCleanupSuggestions.tsx:17`) produces exactly five
kinds of suggestion: deleted GL account, deleted tax code, suggested GL account,
suggested tax code, and vendor-not-used-in-six-months. There is no name-matching
or merge logic anywhere in `src/`.

**C. An advertised assistant prompt has no matching capability.**
The homepage lists "Which vendors are duplicates?" as an example prompt
(`LandingPage.tsx:601`), under a code comment stating these are "Real prompts,
each mapping to a tool the assistant actually has". The assistant has sixteen
tools (`src/lib/chatbot/toolSchemas.ts`) and none of them detects duplicates.

**One point of your brief that the code confirms, with a nuance worth keeping.**
You described Scantrix as posting invoices to QuickBooks automatically right
after the scan. That is accurate: auto-posting is a real pipeline stage
(`BACKEND_duplicate-bills.md` §1) controlled by a per-connection setting that
defaults to on (`src/store/quickBooks/quickBooksSlice.ts:98`, toggled in
`src/components/preferences/PreferencesContent.tsx:146-149`). The nuance is that
only high-confidence invoices post automatically; the rest are held in a review
queue with a reason (`src/store/invoice/invoiceSlice.ts:253-262`). That nuance
is a selling point, not a caveat — "it knows when not to" is what an accountant
wants to hear — and the copy already frames it that way.

---

## 4. Keyword strategy

Built from features that exist in the code, not from a category template. Each
cluster names the page that should own it and whether that page exists.

**Every volume, difficulty and traffic figure below: requires Ahrefs/SEMrush
verification.** The clusters and intent classifications are derived from the
product; the demand behind them is not yet measured.

### Cluster 1 — Problem-aware
*The accountant does not know this category exists. They are describing the pain.*

| Search | Intent | Target page | Status |
|---|---|---|---|
| how to enter bills into QuickBooks faster | Informational | Guide: speeding up bill entry | **Must create** |
| stop manually entering invoices into QuickBooks | Informational | Guide: speeding up bill entry | **Must create** |
| reduce data entry in accounts payable | Informational | Guide: AP data entry | **Must create** |
| month end accounts payable backlog | Informational | Guide: month-end AP | **Must create** |
| accounts payable process for small business | Informational | Guide: AP process | **Must create** |

*Reasoning:* the homepage's own problem section (`LandingPage.tsx:181-199`) names
these three pains in the product's voice — retyping every invoice, matching
vendors by hand, month-end pile-ups. That copy is the seed for these pages. This
cluster will not convert on first visit; it exists to be found early and
remembered.

### Cluster 2 — Solution-aware
*They know the category and are shopping it.*

| Search | Intent | Target page | Status |
|---|---|---|---|
| invoice scanning software | Commercial | `/` | **Exists** |
| accounts payable automation software | Commercial | `/` | **Exists** |
| AP automation for accountants | Commercial | `/` | **Exists** |
| invoice OCR software | Commercial | `/` | **Exists** |
| bill capture software | Commercial | `/` | **Exists** |
| invoice data extraction software | Commercial | `/` | **Exists** |

*Reasoning:* this is the homepage's job and it is now equipped to do it — the
title has been rewritten to lead with the category rather than the brand, and
the `SoftwareApplication` structured data names the category explicitly. Backed
by `scanInvoice` and `postInvoiceToQuickBooks` in `src/store/invoice/invoiceApi.ts`.

### Cluster 3 — Vendor-aware
*They are comparing named products.*

| Search | Intent | Target page | Status |
|---|---|---|---|
| Dext alternative | Commercial | `/compare/dext-alternative` | **Must create** |
| Hubdoc alternative | Commercial | `/compare/hubdoc-alternative` | **Must create** |
| AutoEntry alternative | Commercial | `/compare/autoentry-alternative` | **Must create** |
| Bill.com alternative for QuickBooks | Commercial | `/compare/bill-com-alternative` | **Must create** |
| *X* vs *Y* comparisons | Commercial | comparison pages | **Must create** |

*Reasoning:* the highest purchase intent in the set — someone typing a
competitor's name plus "alternative" has a budget and a complaint. **These pages
are deliberately not drafted here.** Comparison copy makes factual claims about
other companies' products, which carries legal and reputational exposure and
requires someone who has actually used them. See section 6.

### Cluster 4 — Integration
*They are searching from inside the QuickBooks ecosystem.*

| Search | Intent | Target page | Status |
|---|---|---|---|
| QuickBooks invoice scanning app | Commercial | `/` | **Exists** |
| post bills to QuickBooks automatically | Commercial | `/` | **Exists** |
| QuickBooks Online bill automation | Commercial | `/quickbooks-integration` | **Must create** |
| QuickBooks app for invoice data entry | Commercial | `/quickbooks-integration` | **Must create** |
| Intuit App Store — accounts payable | Navigational | *App Store listing, not a web page* | See section 6 |

*Reasoning:* the strongest cluster the product has, because the integration is
genuine and deep — not just a file export. The code connects multiple companies
(`getMyQBConnections`), matches and creates vendors, and syncs the chart of
accounts and tax codes (`fetchQuickBooksAccounts`, `fetchQuickBooksTaxCodes`,
`syncQuickBooksTaxCodes` in `src/store/quickBooks/quickBooksApi.ts`). A dedicated
integration page can be specific in a way the homepage cannot.

### Cluster 5 — Long-tail workflow
*A specific chore they want to stop doing.*

| Search | Intent | Target page | Status |
|---|---|---|---|
| email invoices directly into accounting software | Informational/Commercial | `/features/email-forwarding` | **Must create** |
| forward supplier invoices to QuickBooks | Commercial | `/features/email-forwarding` | **Must create** |
| automatically match vendor invoices to QuickBooks vendors | Commercial | `/` | **Exists** |
| sync chart of accounts and tax codes from QuickBooks | Informational | `/quickbooks-integration` | **Must create** |
| multi-entity invoice processing QuickBooks | Commercial | `/quickbooks-integration` | **Must create** |
| pull invoices from Google Drive into QuickBooks | Commercial | `/features/email-forwarding` | **Must create** |
| Claude / MCP connector for QuickBooks | Informational | `/features/claude-connector` | **Must create** |

*Reasoning:* the most defensible cluster, and the most under-exploited. Two items
are genuinely differentiated. **Email forwarding** — a separate address per
QuickBooks company, with sender allow-lists, anti-spoofing checks and attachment
scanning (`src/lib/inboundEmail/`: `authorization.ts`, `authResults.ts`,
`scanVerdict.ts`, `attachment.ts`) — currently gets one section on a page that
has to sell eleven other things. **The Claude connector** — verified at exactly
33 tools over OAuth 2.1 (`mcp/mcp-server/src/tools/`) — is a category almost
nobody competes in yet. Both deserve their own address.

---

## 5. What we changed

Fourteen files were modified or created and twenty-five were moved. Business
logic, authentication, data handling and the QuickBooks integration were not
touched. The full technical record is in `SEO-CHANGELOG.md`.

| What changed | Before | After | Files |
|---|---|---|---|
| **Search engines now receive the actual page.** The signed-in product was moved behind its own internal boundary so the marketing page no longer waits for the browser. | Homepage HTML contained **0 characters** of text, **0** headings, **0** links | Homepage HTML contains **12,497 characters**, **1** H1, **12** H2s, **34** H3s, **22** links — all present before any JavaScript runs | `src/app/layout.tsx`, new `src/app/(app)/layout.tsx`, `src/app/not-found.tsx`, 25 route folders moved |
| **A robots file now directs crawlers.** | none | Marketing page allowed; the twenty signed-in paths and the API blocked; sitemap declared | new `src/app/robots.ts` |
| **A sitemap now exists.** | none | Lists the one genuinely indexable page. Deliberately not padded with pages that are set to noindex — a sitemap full of pages a crawler is told to ignore stops being trusted. | new `src/app/sitemap.ts` |
| **The private app is closed to search engines.** | ~20 screens returned an ordinary indexable response | Every route behind the login now carries `noindex, nofollow`, set once rather than page by page | new `src/app/(app)/layout.tsx` |
| **Shared links now render a proper card.** | Bare grey URL — no title, no description, no image | Full Open Graph and Twitter Card tags plus a 1200×630 preview image, generated at build time so it can never drift from the page | `src/app/layout.tsx`, new `src/app/opengraph-image.tsx` |
| **The homepage declares its true address.** | No canonical anywhere | Homepage self-canonicalises. Signed-in pages deliberately have none — pointing a private page at the homepage would claim it *is* the homepage | `src/app/layout.tsx`, `src/app/page.tsx` |
| **The homepage title now leads with the category.** | "Scantrix — Invoices, posted to QuickBooks automatically" — brand first, category absent | "QuickBooks Invoice Scanning & AP Automation \| Scantrix" — what they searched for, then who we are | `src/app/page.tsx` |
| **Machine-readable description of the product.** | none | Three structured-data blocks: the company, the software (with a ten-item feature list drawn from the code), and the FAQ | new `src/lib/seo.ts`, `src/app/page.tsx` |
| **A visible FAQ section was added.** Seven questions, each answered from existing copy or verified behaviour. Built with native disclosure markup, so every answer is in the HTML whether or not it is expanded. | none | Seven Q&As, matching the FAQ structured data exactly — Google only credits FAQ markup whose answers are visible on the page | `src/components/landing/LandingPage.tsx`, `src/lib/seo.ts` |
| **Content no longer hides without JavaScript.** | Sections below the fold sat at zero opacity until scrolled into view | A no-JavaScript rule makes them visible immediately; the animation is unchanged for everyone else | `src/app/globals.css` |
| **One fewer font download on the marketing page.** | Two font files preloaded on `/`; one was never used there | One. The mono font now loads only inside the product, where it is actually displayed | `src/app/layout.tsx`, `src/app/(app)/layout.tsx` |
| **The 404 headline is now a real heading**, and the page is marked noindex. | Styled paragraph, no heading, no directive | Proper `<h1>`, `noindex` | `src/app/not-found.tsx` |
| **The canonical domain is configurable.** | Nothing to configure | `NEXT_PUBLIC_SITE_URL`, documented, defaulting to the production origin so a missing setting can never publish a broken address | `.env.local.example`, `src/lib/seo.ts` |

**Verification.** TypeScript passes, the production build succeeds, and all 356
tests pass. Every claim above was confirmed against the built output and against
a running production server, not inferred.

---

## 6. What is still open

Ranked by expected impact against effort. Each needs a decision, budget or
person that is yours, not ours.

| # | Item | Why it matters | Effort | Needs from you |
|---|------|----------------|--------|----------------|
| 1 | **Resolve the three copy/code contradictions in section 3** | Highest priority, and not really an SEO item. A financial product advertising duplicate-invoice protection that its own backlog says is unfixed is a refund and reputation exposure. Options: ship the backend fix, soften the copy, or remove the claims. | Low to decide, unknown to fix | Decision, plus a backend commitment for the duplicate work |
| 2 | **Approve the four to six new pages** (integration, email forwarding, Claude connector, and the comparison set) | This is the single biggest remaining constraint. One page cannot serve five different searcher intents. Everything in section 4 marked *must create* is blocked on this. | Medium | Sign-off on copy, and a writer |
| 3 | **Decide the position on comparison pages** | Highest purchase intent of any cluster. Also the only content with legal exposure — claims about Dext, Hubdoc, AutoEntry and Bill.com must be accurate and current. | Medium | A decision on whether to compete by name; someone who has used the competitors |
| 4 | **Get listed in the Intuit QuickBooks App Store** | A distribution channel and a high-authority link, not something on-site work can substitute for. The product is built entirely around QuickBooks Online. | Medium–High | Intuit's review process; engineering time |
| 5 | **Publish pricing, or decide not to** | Two plans currently read "Monthly / yearly" and the page defers to the app (`LandingPage.tsx:1044-1047`). Structured data was left without a price block for exactly this reason — inventing one was not an option. Published pricing also makes the product eligible for richer search results. | Low | A pricing decision |
| 6 | **Buy keyword tooling and re-run section 4** | Every cluster in this audit is derived from the product and is directionally sound, but unmeasured. Ahrefs or SEMrush turns the list into a priority order. | Low | ~$100–200/month |
| 7 | **Connect Google Search Console and Bing Webmaster Tools** | There is currently no measurement of any of this. Submit the new sitemap on day one; the before/after will be visible within weeks. | Low | Domain access |
| 8 | **Confirm the `www` / non-`www` and trailing-slash decision at the DNS and hosting layer** | Canonicals are now correct in the page. The server should also redirect the variants, which is a hosting setting rather than a code change. | Low | Hosting access |
| 9 | **Decide whether the separately deployed MCP connector site should be indexed** | `mcp/mcp-server` is a second, independently hosted property with its own page and no robots directives. It may be competing with scantrix.ai for the brand name. Its domain was not in scope here. | Low | Confirm the domain; decide index or noindex |
| 10 | **Backlinks** | Nothing on-page substitutes for other credible sites linking to you. Accounting-community placements, the Intuit listing, and integration directories are the realistic starting points. | Ongoing | Budget or an owner |

---

## 7. Thirty / sixty / ninety day plan

Owner column intentionally blank.

### First 30 days — measure, and stop the bleeding

| Action | Owner |
|---|---|
| Deploy the changes in this audit to production | |
| Connect Google Search Console; submit `https://scantrix.ai/sitemap.xml` | |
| Connect Bing Webmaster Tools and submit the same sitemap | |
| Request indexing for the homepage; confirm the rendered version now shows content | |
| Test the homepage in LinkedIn's Post Inspector and Slack to confirm the preview card | |
| Validate the three structured-data blocks in Google's Rich Results Test | |
| **Decide on the three contradictions in section 3** and action the copy | |
| Confirm `www` / non-`www` redirects at the hosting layer | |
| Buy Ahrefs or SEMrush; re-run section 4 with real demand data | |
| Record a baseline: impressions, clicks, average position, indexed page count | |

### Days 31–60 — build the pages that can rank

| Action | Owner |
|---|---|
| Approve the page plan from open question 2 | |
| Write and ship `/quickbooks-integration` — the deepest, most defensible cluster | |
| Write and ship `/features/email-forwarding` | |
| Write and ship `/features/claude-connector` | |
| Add breadcrumb structured data once a real page hierarchy exists (it is invalid until then, and was deliberately omitted) | |
| Add each new page to the sitemap and cross-link from the homepage | |
| Decide the comparison-page position; if yes, commission the first one | |
| Submit the Intuit App Store listing | |
| Re-measure against the day-30 baseline | |

### Days 61–90 — depth and authority

| Action | Owner |
|---|---|
| Publish the first two problem-aware guides from cluster 1 | |
| Ship the first comparison page, if approved | |
| Begin outreach for accounting-community links and integration directories | |
| Review Search Console query data; write the next two pages against what people actually typed, not what we predicted | |
| Add case studies or testimonials — this also makes review structured data valid, which is currently unavailable because there are no reviews to cite | |
| Re-audit page speed with real production traffic data | |
| Second measurement review against baseline | |

---

## Appendix — how this audit was carried out

The repository was read in full: 189 application source files across
`src/app`, `src/components`, `src/lib` and `src/store`, plus configuration and
the separately deployed MCP connector.

Findings were not inferred from source alone. The site was built for production
and the resulting HTML was parsed directly to count words, headings and links on
every route — which is how the empty-body problem was confirmed rather than
suspected. After the changes, a production server was started and every route,
`robots.txt`, `sitemap.xml` and the generated preview image were checked over
HTTP.

Every product claim in this document cites the file it came from. Where the code
and the marketing copy disagreed, the disagreement is reported in section 3
rather than quietly resolved in one direction.
