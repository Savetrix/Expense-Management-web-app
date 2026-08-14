# Backend: duplicate QuickBooks bills, and errors returned after a successful write

**Owner:** Savetrix API (`https://api.savetrix.com/api`) — not this repo.
**Priority:** High. Customer-visible, financial, and currently only mitigated.
**Raised from:** two customer reports — "invoice scanned for a new vendor threw
an error but was still posted to QuickBooks", and "multiple invoices in
QuickBooks with the same invoice number".

The web app has shipped every mitigation it can. The remaining failure modes
are not fixable from the client, because they come from the API committing a
write and then reporting failure, and from there being no dedupe key on the
bill itself.

---
We've added every guard we can on the frontend, but the remaining causes are server-side. Full ticket is BACKEND_duplicate-bills.md on main. The five asks:

POST /invoices shouldn't return an error after it's already created the invoice/bill. Either return success with a warning, or roll back. Right now the client can't tell the difference, so the user re-uploads and we get a duplicate.
Accept an Idempotency-Key header on POST /invoices — same key within 24h returns the original result instead of creating a second record. We'll start sending it as soon as it's supported.
Refuse to create a second bill for the same (connection, vendor, invoice number). normalizedInvoiceNumber already exists on the model. Return something specific like DUPLICATE_INVOICE_NUMBER with the existing invoice and bill ids so we can show it properly.
Same for POST /quickbooks/vendors — it can create the vendor in QuickBooks and still return an error, so a retry makes a second vendor.
Make "mark as posted" atomic — only post if not already posted, in one conditional update. We check before posting, but two simultaneous requests both pass that check and we can't close it from the client.
Also please confirm the "vendor needs a default GL account" rule is enforced server-side and returned as a field-level validation error.

Important for testing: reproduce with two concurrent requests, not just clicking twice. Sequential clicks are already blocked on our side — the concurrent case is the one that still gets through.

---
## 1. The scan pipeline is not atomic

`POST /invoices` performs several steps server-side: store the file, OCR it,
match/create the vendor, and (when auto-post is on) create the bill in
QuickBooks. A later step can fail after an earlier one has already committed.

The client then receives a non-2xx response for a request that **did** create
an invoice record and, sometimes, a QuickBooks bill.

The customer sees "scan failed", re-uploads the same document, and gets a
second record and a second bill.

**Required:**

- Return `2xx` whenever the invoice record was created, even if a later stage
  failed. Carry the partial failure in the body, e.g.
  `{ invoice, status: "created", warnings: [{ stage: "vendor_match", message }] }`.
  Reserve non-2xx for "nothing was persisted".
- If that is not achievable, make the pipeline roll back: no invoice record and
  no bill when the request reports failure.

Anything else leaves the client guessing whether a failed request did work, and
guessing is what produces the duplicate.

## 2. No idempotency on invoice creation

A retry — user re-upload, a client retry, a proxy retry — creates a new invoice
record every time.

**Required:** accept an `Idempotency-Key` request header on `POST /invoices`.
Same key within a reasonable window (24h) returns the original result rather
than creating a second record. The client can generate and send this per
user-initiated upload as soon as the API accepts it.

## 3. No dedupe on the bill itself

QuickBooks rejects duplicate document numbers per vendor (Intuit error `6140`),
but that rejection happens *after* we have already created a second local
invoice record, and it is not surfaced usefully.

**Required:** before creating a bill, reject or link when a bill already exists
for the same `(qbConnectionId, vendorId, normalizedInvoiceNumber)`. The field
`normalizedInvoiceNumber` already exists on the invoice model. Return a
specific, machine-readable error the client can render, e.g.
`{ code: "DUPLICATE_INVOICE_NUMBER", existingInvoiceId, existingBillId }`.

## 4. Vendor creation is not transactional either

`POST /quickbooks/vendors` can create the vendor in QuickBooks and still return
an error. The client then retries and creates a second vendor, which becomes a
second "new vendor" and, downstream, another duplicate bill.

Same requirement as §1: report success when the vendor exists, or roll back.

Related: the API rejects a vendor created without a default GL account
("QuickBooks requires a default GL account for new vendors"). That rule is
correct but was only enforced client-side and inconsistently — both create
paths in the web app now require it. Please confirm it is enforced server-side
too, and returned as a field-level validation error rather than a generic 400.

## 5. `PATCH /invoices/:id` has no server-side re-post guard

If an invoice already carries `quickbooks.billId`, a second PATCH with
`postedStatus: "manual"` should not create another bill. The client checks
this before posting, but two requests arriving together both pass that check —
the client cannot close that race.

**Required:** make the transition to a posted state conditional server-side —
only post when the invoice is not already posted, in a single atomic update.

---

## What the client already does (so you can see the remaining gap)

These are shipped and live on `scantrix.ai`:

| Mitigation | Where | Why it is not enough |
|---|---|---|
| Asks the API for the invoice's current state before posting, and refuses if it already has a `billId` | `src/store/invoice/invoiceApi.ts`, `src/lib/chatbot/tools.ts` | Two posts landing together both read "not posted" before either commits |
| Refuses a second post of the same invoice while one is in flight | same | Per browser tab / per server instance only |
| Warns when another invoice has the same vendor + invoice number and is already billed | `src/components/invoices/InvoiceReviewContent.tsx` | A warning, and only over invoices this account can see |
| No longer re-sends `POST`/`PATCH`/`DELETE` after a 401 refresh | `src/lib/api.ts` | Removes one source of silent retries, not the others |
| De-duplicates the invoice list by `_id` | `src/store/invoice/invoiceApi.ts` | Cosmetic; two real records are still two records |
| Refuses to post with an empty `vendorId` | `src/store/invoice/invoiceApi.ts` | Prevents one bad-post shape, not duplication |
| Tells the user a failed scan may still have been created | `src/components/dashboard/DashboardContent.tsx` | Relies on the customer reading and acting on it |

## Acceptance criteria

1. A `POST /invoices` that fails partway never leaves an invoice record behind
   while reporting failure — or reports success with warnings.
2. Re-sending the same `POST /invoices` with the same `Idempotency-Key` yields
   one record, not two.
3. Posting the same invoice twice — including two simultaneous requests —
   yields exactly one QuickBooks bill; the second returns
   `DUPLICATE_INVOICE_NUMBER` with the existing ids.
4. A vendor create that fails after creating the vendor in QuickBooks does not
   leave a second vendor behind on retry.
5. Reproduce with two concurrent requests, not just sequential clicks — the
   sequential case is already handled client-side.
