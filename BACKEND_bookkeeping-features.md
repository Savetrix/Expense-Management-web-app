# Bookkeeping features (front end only): backend checklist

Branch `ScanTrix-X-Breifcase` adds front-end flows for the bookkeeping features
beyond invoice scanning (modelled on Briefcase Connect). Every flow runs on
local sample data from a `mockData.ts` file in its component folder.

Every control that needs a backend call has a label ending in **(BE)**. It calls
`notifyBackendPending()` from `src/lib/bePlaceholder.ts`, shows an info toast
and moves the sample data forward, so each flow can be clicked through from
start to finish. To wire one up, replace the `notifyBackendPending` call with a
thunk (`src/store/<feature>/<feature>Api.ts` + slice, the usual pattern) and
replace the `mockData.ts` seed with a fetch.

The endpoint paths below are **suggestions** that show the shape of each call.
None of them exist yet.

## New pages

| Route | Folder | Feature |
|---|---|---|
| /autopilot | `src/components/v2/autopilot/` | Autopilot switch, the three checks, Needs review queue, Autopublished list, decision trail, AI memories, usage |
| /archive | `src/components/v2/archive/` | Archive reasons, duplicate comparison, unarchive and delete, bulk actions, merge wizard |
| /supplier-statements | `src/components/v2/supplierStatements/` | Upload statement, line matching (full, partial, manual), mark reconciled |
| /expense-claims | `src/components/v2/expenseClaims/` | Claims by claimant and month, new-claim wizard, mileage journeys, drivers, vehicles, rates |
| /bank-transactions | `src/components/v2/bankTransactions/` | Connect a bank with Plaid, import a CSV file, match transactions to bills |
| /payments | `src/components/v2/payments/` | Payment run wizard (bank-detail checks, approval, pay or request authorisation), approvals, runs, approval rules |
| /month-end | `src/components/v2/monthEnd/` | Prepayments, deferred income, fixed assets (incl. disposal), accruals, bulk import, detection settings |
| /close | `src/components/v2/close/` | Working papers: 5-section close checklist, reconciliations, drift check, close and reopen, Excel export |
| /requests | `src/components/v2/requests/` | Paperwork requests wizard, reminder schedule, item tracking |
| /audit-trail | `src/components/v2/auditTrail/` | Filterable activity log with before/after changes |

## Additions to existing pages

- **Integrations** (`AccountingSoftwaresContentV2.tsx`): two new rows. "WhatsApp" opens `capture/WhatsAppCaptureModal.tsx`; "Allowed senders" opens `capture/AllowedSendersModal.tsx`.
- **Team** (`TeamMembersContentV2.tsx`): a Permissions button on each member row, an optional permissions step in the invite form, and an invite-link panel. All live in `team/MemberPermissionsModal.tsx`.
- **Invoice detail** (`InvoiceDetailContentV2.tsx`): `invoiceInsights/InvoiceInsightsPanel.tsx`, which adds "Why Scantrix coded it this way", "Mark as" (prepayment, deferred income, fixed asset, sales, expense claim) and "Pay this bill".
- **Sidebar** (`AppShell.tsx`): 9 new entries in `NAV_ITEMS`.

## (BE) actions → suggested endpoints

### Capture
- Send verification code / Resend → `POST /capture/whatsapp/verify/start`
- Verify → `POST /capture/whatsapp/verify/confirm`
- Disconnect WhatsApp → `DELETE /capture/whatsapp`
- Save allowed senders → `PUT /capture/email/allowed-senders`

### Autopilot and AI
- Save Autopilot setting → `PATCH /autopilot/settings {companyId, enabled}`
- Approve & publish → `POST /autopilot/documents/:id/publish`
- Undo publish → `POST /autopilot/documents/:id/unpublish`
- Archive (from review) → `POST /documents/:id/archive`
- Memories: accept / dismiss / add / edit / delete → `POST /ai-memories/:id/accept`, `POST /ai-memories/:id/dismiss`, `POST /ai-memories`, `PATCH /ai-memories/:id`, `DELETE /ai-memories/:id`
- Usage Export CSV → `GET /autopilot/usage/export`
- Coding reasoning on invoice detail (currently sample data) → `GET /invoices/:id/reasoning`
- Reads: `GET /autopilot/documents?status=`, `GET /autopilot/stats`, `GET /ai-memories`, `GET /autopilot/usage`

### Archive & duplicates
- Unarchive / Not a duplicate → `POST /archive/:id/unarchive {notDuplicate?}`
- Delete permanently → `DELETE /archive/:id`
- Download original → `GET /archive/:id/original`
- Bulk unarchive / delete → `POST /archive/bulk-unarchive`, `POST /archive/bulk-delete`
- Merge → `POST /documents/merge {primaryId, ids}`
- Reads: `GET /archive?reason=`, `GET /documents?status=unposted`

### Invoice detail "Mark as"
- Create prepayment / deferred income schedule → `POST /month-end/schedules`
- Create asset → `POST /fixed-assets`
- Move to sales → `POST /invoices/:id/reclassify {type: "sales"}`
- Add to claim → `POST /expense-claims/:id/items`

### Supplier statements: syncing from the accounting software
- QuickBooks has no "statement" document. The "From QuickBooks" view is built from the bills Scantrix has posted (already in the app). The "Sync from QuickBooks (BE)" button needs `GET /quickbooks/vendor-accounts`, built from QuickBooks' Vendor Balance Detail / A/P Aging reports plus Bill and BillPayment queries, returning per vendor: bills (number, date, due date, amount, balance), payments and the open balance. Xero equivalent: Aged Payables by Contact.

### Audit trail
- The Audit Trail already lists real activity from invoices (upload, status changes, who posted, email vs web). Edits, archive, approvals, payments, settings changes and member invites need `GET /audit-events` (one record per action with actor, source, before/after).

### Supplier statements
- Upload → `POST /supplier-statements` (multipart)
- Accept match / Reject → `POST /supplier-statements/:id/lines/:lineId/accept|reject`
- Match → `POST /supplier-statements/:id/lines/:lineId/match {billId}`
- Mark statement reconciled → `POST /supplier-statements/:id/reconcile`
- Reads: `GET /supplier-statements`, `GET /bills?unmatched`

### Expense & mileage claims
- Create claim → `POST /expense-claims {claimant, receiptIds}` (plus `POST /contacts` for a new claimant)
- Approve / Approve & pay → `POST /expense-claims/:id/approve[?pay=true]`
- Publish to accounting software → `POST /expense-claims/:id/publish`
- Remove receipt → `DELETE /expense-claims/:id/receipts/:receiptId`
- Mark as paid / Pay employee → `POST /expense-claims/:id/mark-paid`, `POST /expense-claims/:id/pay`
- Calculate distance → `GET /mileage/distance?from&to`
- Create journey / Publish as bill / Delete → `POST /mileage/journeys`, `POST /mileage/journeys/:id/publish`, `DELETE /mileage/journeys/:id`
- Save drivers / vehicles / rates → `PUT /mileage/drivers`, `POST|PUT /mileage/vehicles`, `PUT /mileage/rates`

### Bank transactions (Plaid)
- Connect a bank → `POST /plaid/link-token` (backend creates the Plaid link token, the front end opens Plaid Link with it; see `src/components/v2/bankTransactions/plaid.ts` for the launcher contract), then `POST /plaid/exchange-public-token {publicToken, institution, accounts}`
- Reads: `GET /bank-accounts`, `GET /bank-transactions?status=&accountId=&from=&to=`
- Sync now / Disconnect / Save mapping → `POST /bank-accounts/:id/sync`, `DELETE /bank-accounts/:id`, `PUT /bank-accounts/:id/mapping {ledgerAccountId}`
- Import file rows (the CSV is parsed in the browser; saving needs the backend) → `POST /bank-transactions/import`
- Match / create expense / import selected → `POST /bank-transactions/:id/match {invoiceId}`, `POST /bank-transactions/:id/create-expense`, `POST /bank-transactions/import-to-ledger {ids}`
- Plaid webhooks: transaction updates (new, modified, removed), and "login required" so the account can show "Needs re-login"

### Reports and bank suggestions
- Reports (/reports) are built in the browser from the invoices Scantrix has read: spend by vendor, month and GL account, and tax paid, with CSV download. A real profit and loss needs ledger data: `GET /reports/profit-and-loss?from=&to=` (and balance sheet / cash position from the accounting software).
- Bank suggestions (accept, accept all) → `POST /bank-transactions/:id/match {invoiceId}` and a batch version; "Mark as transfer" → `POST /bank-transactions/:id/transfer {counterpart}`.
- Period Close "Clear the bank" needs the count of unsorted bank lines per period: `GET /bank-transactions?status=to_review&to=<periodEnd>`.

### Payments & approvals
- Send for approval → `POST /payments/approval-requests {billIds}`
- Pay {total} / Request authorisation → `POST /payment-runs {bills, references, payFromAccountId, confirmedBankDetails, mode}`
- Approve / Approve & pay / Reject → `POST /payments/approval-requests/:id/approve|approve-and-pay|reject`
- Retry payment / Resend authorisation → `POST /payment-runs/:id/retry`, `POST /payment-runs/:id/resend-authorisation`
- Save rules → `PUT /payments/approval-rules`
- Data needed: unpaid bills with vendor bank details and a "details changed" flag, paying bank accounts, team members

### Month-end adjustments
- Save detection settings → `PUT /month-end/settings`
- Create (prepayment, deferred income, asset, accrual, adjustment) → `POST /month-end/{type}`
- Publish schedule / asset → `POST /month-end/{type}/:id/publish`
- Archive (posts reversing journals) / Unarchive → `POST /month-end/{type}/:id/archive|unarchive`
- Dispose asset → `POST /month-end/fixed-assets/:id/dispose`
- Accruals: approve & post / dismiss / post reversal → `POST /month-end/accruals/:id/approve|dismiss|reverse`
- Download template / Import N rows → `GET /month-end/{type}/import-template`, `POST /month-end/{type}/import`
- Export CSV / Re-check reconciliation → `GET /month-end/{type}/export`, `GET /month-end/{type}/reconciliation`

### Working papers (close)
- Start close → `POST /close/working-papers`
- Post / Archive pending invoice → `POST /invoices/:id/post|archive`
- Post adjustment / Post all → `POST /month-end/adjustments/:id/post`, `POST /month-end/adjustments/post-all?period=`
- Resolve flag → `POST /close/:wpId/contacts/:id/resolve` (multipart)
- Reconcile payables / receivables / fixed assets → `POST /close/:wpId/{payables|receivables|fixed-assets}/reconcile`
- Save / Reconcile / Undo account → `PUT /close/:wpId/accounts/:id`, `POST|DELETE /close/:wpId/accounts/:id/reconcile`
- Close period (re-checks balances for drift, then locks) → `POST /close/:wpId/close`
- Export to Excel → `GET /close/:wpId/export`
- Reopen period → `POST /close/:wpId/reopen`

### Paperwork requests
- Send request → `POST /requests`
- Send reminder now → `POST /requests/:id/reminders`
- Mark item received / Mark complete / Cancel → `POST /requests/:id/items/:itemId/received`, `POST /requests/:id/complete`, `POST /requests/:id/cancel`
- Inbound reply matching (email reply with attachments, no login) is entirely backend work

### Team permissions
- Save permissions → `PUT /members/:id/permissions`
- Create invite link → `POST /members/invite-links`
- Invite with preset → `POST /members/invite` with a `permissions` field (the current invite call ignores it)

### Audit trail
- Export CSV → `GET /audit-events/export` (for now it downloads the rows on screen)
- Read: `GET /audit-events`

## Known gaps

- The sidebar now has 16 items. Grouping them (for example under "Bookkeeping" and "Month-end") would mean a UI change, so it was left as is.
- There is no separate Sales inbox. Sales documents are covered by "Mark as → Sales document" on invoice detail.
- Tax return filing and raising sales invoices were left out on purpose. Those belong to Briefcase's own ledger product, not to an add-on for accounting software.
