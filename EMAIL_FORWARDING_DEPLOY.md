# Invoice forwarding by email — setup and test runbook

Everything below is doable in one sitting. **Steps 1–5 need no DNS at all** — use
the Resend-managed subdomain, forward a real invoice, and watch it appear. Move
to `invoice.scantrix.ai` (step 8) whenever you like; it is one env var and one MX
record.

Design rationale lives in [`EMAIL_INVOICE_INGESTION_ARCHITECTURE.md`](./EMAIL_INVOICE_INGESTION_ARCHITECTURE.md).
This file is the operational half.

---

## 0. What you are switching on

An accountant opens **Integrations → a QuickBooks company → Email forwarding**,
presses one button, and gets an address:

```
acme-corp-7k2m9x@<your-id>.resend.app
```

Forwarding a supplier invoice to it is equivalent to dragging that attachment
onto the dashboard. Same extraction, same vendor matching, same duplicate
checks, same review queue, same posting rules.

**One address per QuickBooks company.** That is the whole answer to an accountant
managing several clients: the address itself decides which company an invoice is
filed under, so nobody has to pick at forward time and nothing can land in the
wrong set of books. The random 6-character suffix is load-bearing — QuickBooks
company names are *not* unique across your customers, so two clients each
managing an "Acme Corp" would otherwise collide on one address.

---

## 1. Create the Resend receiving domain

1. Sign in to Resend → **Inbound** (or **Domains → Receiving**).
2. Take the **Resend-managed subdomain** it offers: `<something>.resend.app`.
   No DNS records. It receives mail for **any** local-part immediately, which is
   exactly what we need — every accountant's address is a different local-part on
   one domain.
3. Note the full subdomain. That is `INBOUND_EMAIL_DOMAIN`.

## 2. Create the API key

**API Keys → Create**, with permission to read received emails and their
attachments. That is `INBOUND_PROVIDER_API_KEY`.

It is used for exactly three calls:

| Call | Why |
|---|---|
| `GET /emails/receiving/{id}` | Headers (for the sender + auth checks) and `received_for` |
| `GET /emails/receiving/{id}/attachments` | Fresh signed `download_url` per file |
| `GET <download_url>` | The bytes |

## 3. Create the receiving webhook

Point it at your deployment:

```
https://<your-app>/api/inbound/email
```

Subscribe to **`email.received`**. Copy the signing secret it shows you — that is
`INBOUND_WEBHOOK_SIGNING_SECRET`.

> The endpoint answers `GET` with `{"status":"ready"}` if Resend probes it before
> saving. That reveals nothing about configuration.

## 4. Generate the encryption key

```sh
openssl rand -base64 32
```

That is `INBOUND_TOKEN_ENCRYPTION_KEY`. **Required** — address creation refuses
without it.

It encrypts the delegated refresh token at rest. Rotating it makes every stored
delegation unopenable and each address shows "Needs reconnect" until the owner
presses **Reconnect**. That is the safe failure direction: nothing leaks,
forwarding just stops.

## 5. Set the environment and deploy

```sh
INBOUND_EMAIL_ENABLED=true
INBOUND_EMAIL_PROVIDER=resend
INBOUND_EMAIL_DOMAIN=<your-id>.resend.app
INBOUND_PROVIDER_API_KEY=re_...
INBOUND_WEBHOOK_SIGNING_SECRET=whsec_...
INBOUND_TOKEN_ENCRYPTION_KEY=<openssl output>
INBOUND_REQUIRE_EMAIL_AUTH=false     # tighten in step 7
```

`BLOB_READ_WRITE_TOKEN` must already be set — the same Vercel Blob store chat
history uses. Nothing new to provision.

Every one of these is **server-only**. Adding `NEXT_PUBLIC_` to any of them would
publish it in the browser bundle.

---

## 6. The first real test

1. Sign in. Go to **Integrations → accounting-software**.
2. Click a connected QuickBooks company to open its detail panel.
3. Scroll to **Email forwarding** → **Turn on email forwarding**.
   - The server verifies you own that company, then proves your session can
     actually be delegated *before* it shows you an address. If it can't, you get
     told immediately instead of discovering it on your first invoice.
4. Copy the address.
5. **From the email account you signed in with**, forward a real supplier invoice
   (PDF attached) to it.
6. Within a few seconds: the invoice appears in the invoice list with an
   **Email** badge, and the **Recent email imports** list in that panel shows the
   subject and "1 invoice".

### If nothing arrives

Check in this order:

| Where | What it tells you |
|---|---|
| Resend → Webhooks → your webhook | Was the delivery attempted, and what status did we answer? |
| A `503` answer | We asked for redelivery. Resend retries 8× over ~32h — check logs for `[inbound] <id> retry=...` |
| A `401` answer | Signature or timestamp. Wrong `INBOUND_WEBHOOK_SIGNING_SECRET`, or badly skewed clock |
| A `200` with `"rejected"` | A policy decision. The reason is in the response body and in the panel |
| **Recent email imports** in the panel | Plain-English reason, per message |
| Runtime logs, `[inbound]` prefix | Correlation id + structural outcome. Never bodies, bytes, or tokens |

Most likely first-run rejections:

- **`unknown_alias`** — `INBOUND_EMAIL_DOMAIN` does not match the domain you sent
  to. It must be exactly the receiving domain, no `@`.
- **`sender_not_registered`** — you forwarded from a different mailbox than the
  one on your Scantrix account. Add it under **additional senders** in the panel,
  or forward from the account address.
- **`no_supported_attachments`** — the invoice was a link in the body, not an
  attachment. Body links are deliberately never fetched.

---

## 7. Tighten sender authentication

This step exists because of a real gap between the design and the provider:
**Resend's inbound webhook carries no SPF/DKIM/DMARC results.** Verdicts are
parsed out of the `Authentication-Results` header on the fetched message instead.

1. After your test forward, open **Recent email imports** → **Sender
   authentication details**.
2. Read what actually arrived:
   - **Trust: no authentication header arrived** → leave
     `INBOUND_REQUIRE_EMAIL_AUTH=false`. Turning it on would reject everything.
     Your gate remains the verified-sender check, which is the stronger control
     anyway.
   - **Trust: header present but unverified** → copy the **Reported by** value
     (e.g. `mx.resend.com`) into `INBOUND_EXPECTED_AUTHSERV_ID`, then set
     `INBOUND_REQUIRE_EMAIL_AUTH=true`.
3. Redeploy and forward one more invoice. The block should now read
   **Trust: verified**.

Why the pin matters: a forwarded invoice carries the *original* sender's headers
too, and anyone can type `Authentication-Results: x; dmarc=pass` into a message.
Resend returns headers as a JSON object, so duplicates are collapsed before we
see them and we cannot tell which survived. Pinning the authserv-id is what makes
these verdicts mean anything. Until it is set the panel says "advisory" rather
than pretending otherwise.

---

## 8. Move to `invoice.scantrix.ai` (optional, when ready)

This is the DNS step. Doing it on a **subdomain** means a mistake cannot affect
mail delivery for `scantrix.ai` itself.

1. Resend → add `invoice.scantrix.ai` as a receiving domain.
2. Add the **MX** record Resend shows you, on `invoice.scantrix.ai`, at the
   **lowest priority number** on that name. Mail is delivered to the lowest
   priority MX, so a stray higher-priority record wins and nothing arrives.
3. Recommended, on the subdomain only:
   - `TXT _dmarc.invoice` → `v=DMARC1; p=quarantine; rua=mailto:dmarc@scantrix.ai`
4. Wait for Resend to show the domain verified.
5. Set `INBOUND_EMAIL_DOMAIN=invoice.scantrix.ai` and redeploy.

**Existing addresses keep their local-part but not their domain.** An address
minted while the env var said `<id>.resend.app` still displays with that domain
in its stored `receivingAddress`. Have each user press **Generate a new address**
after the cutover, or do it before rolling out to anyone but yourself.

Do not touch `scantrix.ai`'s own MX records at any point.

---

## Rollback

| Action | Effect | Manual upload |
|---|---|---|
| `INBOUND_EMAIL_ENABLED=false` | Messages recorded, no invoices created. Replay imports them later | Unaffected |
| Turn off forwarding for one company | That address stops immediately; stored credential deleted | Unaffected |
| **Generate a new address** | Old address dies at once | Unaffected |
| Delete the Resend webhook | Mail stops at the edge | Unaffected |
| Rotate `INBOUND_TOKEN_ENCRYPTION_KEY` | All delegations dead; each shows "Needs reconnect" | Unaffected |

Email ingestion is never a dependency of the manual pipeline. Nothing in this
list can break the Upload button.

---

## How durability works (worth knowing before you page someone)

There is no queue to operate, because **Resend's retry schedule is the queue**:
immediately, 5s, 5m, 30m, 2h, 5h, 10h, 10h — 8 attempts over ~32 hours, plus
manual replay from its dashboard.

- We answer **`200`** when the outcome is settled, including every policy
  rejection. Retrying a rejected sender for 32 hours would only burn quota.
- We answer **`503`** when nothing was settled — store unreachable, provider
  fetch failed, upload failed transiently. Resend redelivers, and the message
  record resumes from where it stopped rather than starting over.

**One case needs a human, and it is deliberate.** If an attempt uploads a file and
dies before recording the result, we do not know whether the invoice exists. We
**do not re-upload it** — the backend has no dedupe on
(connection, vendor, invoice number) (see `BACKEND_duplicate-bills.md`), so a
retry could put a second bill in QuickBooks. The attachment is marked failed with
"upload outcome unknown; not retried to avoid a duplicate bill" and surfaced in
the panel. This mirrors the rule `src/lib/api.ts` already applies to any write
that 401s: never re-send a write whose outcome is unknown. Duplicate bills are
worse than a rare manual re-forward.

---

## What is stored, and where

Vercel Blob, private access, no public URLs. **No email bodies and no attachment
bytes are ever persisted** — attachments stream from Resend straight to
`POST /invoices`.

| Path | Contents |
|---|---|
| `inbound-email/v1/aliases/<sha256>.json` | One address: company, owner, sender allow-list, sealed refresh token |
| `inbound-email/v1/users/<sha256(userId)>.json` | A user's addresses, recent activity, email-sourced invoice ids |
| `inbound-email/v1/messages/<sha256(eventId)>.json` | Per-delivery idempotency + audit record. Subject truncated to 200 chars |

`store.pruneMessages(retentionDays)` deletes aged message records. It is not on a
schedule yet — call it from a Vercel Cron route if volume ever justifies it.

## The security tradeoff you agreed to, stated plainly

To create an invoice as the accountant, the webhook needs their authority — and
it has no browser session. The backend has no service-credential ingestion path
(it is not in this repo), so we store a **delegated refresh token**:

- Captured only when the user explicitly enables forwarding, while signed in.
- Sealed with **AES-256-GCM**, keyed by `INBOUND_TOKEN_ENCRYPTION_KEY`, with the
  alias's token hash bound in as AAD — so a stored blob cannot be moved from one
  company's address to another's.
- Verified at capture time to be valid **and to belong to the caller**.
- Never logged, never returned to a browser, deleted the instant forwarding is
  turned off.
- If it stops working, ingestion halts with `credential_expired` and the panel
  says "Reconnect". It never silently falls back to anything.

The clean long-term replacement is a narrow backend endpoint
(`POST /internal/invoices/ingest`) authenticated by a short-lived service
credential. `IngestAuthority` in `src/lib/inboundEmail/ingest.ts` is the seam:
swapping to it is a second implementation of one two-method interface, and
`pipeline.ts` never learns of the change.
