import { SUPPORT_EMAIL } from "@/lib/legal";

// The in-site reading copy of "Duplicate Invoices". Same text as the downloadable
// PDF (public/ebooks/duplicate-invoices-guide.pdf). Markdown, rendered by
// renderMarkdown in src/lib/blog.ts; no H1 (the page title is the H1) and
// chapters start at "##".
export const body = `
## The short version

- A **duplicate invoice** is a second record of something already recorded or paid. The dangerous ones are **near-duplicates**: a different invoice number, a different format, or the same vendor under a slightly different name.
- Duplicates rarely come from carelessness. They come from **process gaps**: more than one intake channel, duplicate vendor records, statements treated as invoices, and bank-feed entries that double a bill.
- Benchmarking data from APQC found that duplicate or erroneous payments were about **0.8% of disbursements for top performers and over 2% for bottom performers**.
- QuickBooks Online and Xero can warn about a reused bill number, but they do not reliably catch near-duplicates. You need checks **at capture**, not only at payment.
- The fix is a **five-layer system**: one intake channel, a clean vendor list, detection at capture, approval before posting, and a monthly review.

## 1. What is a duplicate invoice?

> **Short answer:** A duplicate invoice is a second record of an obligation that has already been recorded or paid. It may be an identical copy, or a near-duplicate that looks different but refers to the same purchase.

The word "duplicate" covers three related problems, and it helps to keep them apart because each is fixed at a different point.

**Duplicate invoice, duplicate bill and duplicate payment compared**

| Term | What it means | Where it does damage |
| --- | --- | --- |
| **Duplicate invoice** | The same supplier document received twice, or two documents for the same purchase. | Creates confusion at intake. Harmless until someone records it. |
| **Duplicate bill** | The same obligation recorded twice in QuickBooks Online or Xero. | Overstates expenses and accounts payable. Distorts reports and taxes. |
| **Duplicate payment** | The same obligation paid twice. | Real cash leaves the business, and getting it back takes effort. |

Most of the work in this guide is about stopping a duplicate invoice from becoming a duplicate bill, because that is the last point where the fix is free. Once it becomes a duplicate payment, you are asking a supplier for money back.

### Exact duplicates and near-duplicates

An **exact duplicate** has the same vendor, invoice number, date and amount as an earlier document. Almost any system can catch these when the fields are typed identically.

A **near-duplicate** refers to the same purchase but differs in at least one field. Examples include an invoice number written as "INV-5521" on one copy and "5521" on another, a vendor name entered as "Northern Supply Co" and "Northern Supply Company", or a re-issued invoice that has a new number but the same line items. Near-duplicates are where most of the money is lost, because the checks built into accounting software compare for equality and equality fails the moment one character differs.

> An exact-match check only catches the duplicate you would have caught anyway.

## 2. Why duplicates happen: ten common causes

> **Short answer:** Duplicates happen because the same invoice reaches the books through more than one route, because the vendor exists more than once, or because a bill and a bank transaction both record the same spend. People are rarely the root cause. Process gaps are.

Knowing the cause tells you where to put the control. These ten account for most of what bookkeepers find.

**Ten common causes of duplicate invoices**

| Cause | What it looks like | Where to put the control |
| --- | --- | --- |
| **1. Multiple intake channels** | The client emails an invoice to you, and also uploads a photo of it. | One agreed intake route, with duplicate detection at capture. |
| **2. Supplier reminders** | A "past due" email arrives with the original invoice attached again. | Detection at capture. Teach clients to forward, not file, reminders. |
| **3. Statements treated as invoices** | A monthly statement lists ten invoices, and someone enters them again. | Process rule: statements are for reconciliation, never for entry. |
| **4. Duplicate vendor records** | "Amazon Web Services" and "AWS" are two vendors, each with the same bill. | Vendor list cleanup and vendor matching at capture. |
| **5. Bill plus bank-feed entry** | An invoice is entered as a bill, then the card or bank transaction is categorized as an expense. | Match bank transactions to bills. Review uncategorized feed items against open bills. |
| **6. Re-issued invoices** | A supplier corrects an invoice and sends a new number, and both are posted. | Review rule: a new number for the same vendor, date and amount goes to a person. |
| **7. Inconsistent invoice numbers** | "INV-5521", "5521" and "INV 5521" are treated as different. | Normalize invoice numbers before comparing. |
| **8. Multiple people entering** | Two team members each process the same shared inbox. | One person or system owns intake. Roles limit who can post. |
| **9. Paid outside the process** | A client pays an invoice directly, then it is also paid through the bill-pay run. | Require approval before payment, and check for payments already made. |
| **10. Credit memos not applied** | A credit exists but is not matched, so a re-billed invoice looks new. | Apply credits when received. Review open credits at month-end. |

### The pattern behind the list

Look at the "where to put the control" column. Three of the ten need a single intake route, three need a clean vendor list or normalized data, and the rest need review at the point of posting. That is why the prevention system in Chapter 6 has five layers rather than one clever tool.

> **Tip:** Ask each client how invoices reach you today. If the answer includes the words "sometimes" or "also", you have found a duplicate risk.

## 3. What duplicate invoices cost

> **Short answer:** Benchmarking data from APQC found that duplicate or erroneous payments were roughly 0.8% of annual disbursements even at top-performing organizations, and more than 2% at the bottom. The real cost for a client depends on invoice volume and average value, so measure it from their own data.

### What the benchmark says

APQC publishes an Accounts Payable benchmark that tracks the share of disbursements that are duplicate or erroneous. An APQC executive writing for CFO.com reported that top performers still see close to 0.8% of annual disbursements fall into this category, while bottom performers see more than twice that, at over 2%. Two details matter when you quote this. The figure is a share of *payments*, not of dollars, and it combines duplicate payments with other errors such as payments to the wrong vendor or for the wrong amount. The same article points out that a single duplicate can still reach tens of thousands of dollars, which is why the percentage understates the impact on a small business.

The more useful lesson is the gap between top and bottom performers. The difference comes from how mature the controls are, not from how many invoices a company handles.

### Six places the cost shows up

- **Cash.** Money paid twice is unavailable until the supplier returns it. Suppliers are not always quick to do so without prompting.
- **Overstated expenses.** A duplicate bill inflates expenses and payables, which distorts profit, budgets and sales tax or GST/HST input claims.
- **Time.** Finding, confirming, reversing and chasing a duplicate often takes longer than entering the original invoice.
- **Vendor relationships.** Awkward calls to ask for refunds, and statements that no longer agree with your records.
- **Reconciliation noise.** A duplicate bill leaves a vendor balance that never clears, which clutters every month-end.
- **Professional risk.** For a bookkeeper or accountant, a duplicate that reaches a client's financial statements or tax return is a quality issue, not just an inconvenience.

### How to estimate the cost for one client

You do not need a benchmark to size your own exposure. Use a short calculation based on the client's data.

1. **Count the bills.** Find how many supplier bills the client processes in a typical month.
2. **Find the average bill value.** Divide total bills for the period by the count.
3. **Run a duplicate scan.** Use the audit method in Chapter 5 on the last three months and count the duplicates you find.
4. **Multiply.** Duplicates found, times average value, gives the amount that was exposed in that period. Add the time spent resolving them.

**Illustrative example, not a benchmark:** a bookkeeper supports ten clients that average 80 bills a month, which is 800 bills. If a scan finds that 1% are duplicates, that is eight duplicates a month. At an average bill of $450, about $3,600 of spending is exposed each month before anyone catches it, plus the hours spent reversing it. Your numbers will differ. The point is that a small percentage turns into a meaningful amount across many invoices.

## 4. What QuickBooks Online and Xero catch, and what they miss

> **Short answer:** QuickBooks Online and Xero can warn when you enter a bill number that has already been used for the same vendor. They do not reliably catch near-duplicates, statement lines, second vendor records, or a bill that was also entered through the bank feed.

Accounting platforms are built to record transactions accurately, not to investigate whether a document is a repeat. They help in one narrow situation: when a person types a bill number that matches an earlier bill from the same vendor, the software can show a warning. Warning behaviour and settings vary by platform, plan and version, so test it in a client file before you rely on it.

### Why exact-match warnings are not enough

A warning on a reused number depends on four things being true at once: the number is entered, it is entered identically, it is entered against the same vendor record, and the earlier bill is still in the data the check looks at. Real duplicates break at least one of those conditions.

**Typical gaps in built-in duplicate warnings**

| Situation | Likely to be caught by an exact-number warning? |
| --- | --- |
| **Same bill number typed twice for the same vendor** | Often yes |
| **Bill number formatted differently ("INV-5521" and "5521")** | Often no |
| **Same invoice entered under two vendor records** | No, they are different vendors to the system |
| **No bill number on the document** | No, nothing to compare |
| **Bill entered, then the bank transaction coded as an expense** | No, the two records are in different parts of the system |
| **Re-issued invoice with a new number** | No |
| **Statement line entered as a new bill** | No |

The same pattern applies in both platforms. Treat built-in warnings as a useful last line of defence, and put the main checks upstream, where an invoice first arrives.

## 5. How to find duplicates already in the books

> **Short answer:** Export the last three to twelve months of bills, sort by vendor, then amount, then date, and look for repeats. Then check the vendor list for near-identical names, and compare bank-feed expenses with bills for the same amounts.

Run this audit when you take on a client, and again once a quarter. It takes about 30 minutes per client for a small business, and it usually finds something.

1. **Export bills and expenses.** From QuickBooks Online or Xero, export bills, expenses and credit card transactions for the period into a spreadsheet. Include vendor, date, number, amount and memo.
2. **Sort by vendor, then amount, then date.** Same-vendor, same-amount items within 90 days of each other are your first suspects. Highlight them.
3. **Compare amounts across vendors.** Sort by amount only. The same amount on the same day under different vendor names points to a duplicate vendor record.
4. **Review the vendor list.** Sort vendors alphabetically and look for near-identical names, abbreviations and "Inc" or "Ltd" variants. Merge or deactivate extras once the bills are reconciled.
5. **Compare bank-feed expenses with bills.** Look for bank or card transactions categorized directly to an expense when a bill for the same vendor and amount already exists.
6. **Check supplier statements.** For your top suppliers, compare the supplier statement balance with the vendor balance in the books. A difference often points to a duplicate or a missing credit.
7. **Classify each suspect.** Mark each as a true duplicate, a legitimate repeat (such as a subscription), or a corrected invoice. Correct only what you have confirmed.

### Red flags that deserve a second look

- Round-number repeats from the same vendor in the same week.
- Invoice numbers that are one digit apart, or the same number with a prefix added.
- A vendor balance that does not clear even though payments were made.
- Two bills with identical line items and different invoice dates.
- Credits sitting unapplied against a vendor that has since been re-billed.

> **Note:** Do not delete or void anything until you have confirmed it. If an item has been paid, follow the steps in Chapter 9 so that the vendor balance and the bank both reconcile.

## 6. The five-layer prevention system

> **Short answer:** Stop duplicates with five layers: one intake channel, a clean vendor list, duplicate detection at capture, approval before posting, and a monthly review. No single layer is enough, and together they remove most of the ten causes.

### Layer 1: One intake channel

Agree with each client how invoices reach you, and make it one route. A dedicated forwarding email address or an upload link works well. If every invoice enters through the same door, every invoice can be checked against the same history. Tell clients what to do with reminders and statements: forward them to the same address and let the system decide what they are.

### Layer 2: A clean vendor list

The APQC executive writing for CFO.com identified poor vendor data, such as incomplete or duplicated vendor master records, as one of the biggest causes of duplicate or erroneous payments, and recommended routine maintenance of the vendor file, at least annually and ideally quarterly. In QuickBooks Online and Xero, that means reviewing the vendor or contact list, merging or deactivating duplicates, and using consistent names. Match each incoming invoice to an existing vendor rather than creating a new one by default.

### Layer 3: Detection at capture

Check each invoice against earlier ones the moment it arrives, before it becomes a bill. Compare the vendor, invoice number, date and amount, and tolerate small differences in formatting. Chapter 7 explains how this works. The point of doing it at capture is that a flagged invoice costs one decision, while a posted duplicate costs an investigation.

### Layer 4: Approval before posting

Require that a person with authority approves each invoice before it reaches the books. Pair this with roles, so that people who only submit invoices cannot post them. The same CFO.com article stresses segregating accounts payable duties, so that one person cannot approve a supplier, pay invoices and sign cheques, and recommends a review step to confirm that something has not already been approved and paid in an earlier period. In a small firm you may be the only reviewer, which makes the approval record itself the control.

### Layer 5: A monthly review

At month-end, run a short duplicate review before closing the period. Look at bills sorted by vendor and amount, review unmatched bank-feed items against open bills, check open credits, and confirm that vendor balances agree with supplier statements for your largest suppliers. This is the layer that catches anything the others missed, and it tells you which layer needs improvement.

**Which layer addresses which cause**

| Cause from Chapter 2 | Primary layer |
| --- | --- |
| **Multiple intake channels, multiple people entering** | Layer 1 |
| **Duplicate vendor records, inconsistent invoice numbers** | Layers 2 and 3 |
| **Supplier reminders, re-issued invoices** | Layers 3 and 4 |
| **Statements treated as invoices, paid outside the process** | Layers 1 and 4 |
| **Bill plus bank-feed entry, unapplied credits** | Layer 5 |

## 7. How automated duplicate detection works

> **Short answer:** Automated detection extracts the vendor, invoice number, date and amount when an invoice arrives, cleans those values into a standard form, compares them with earlier invoices including near-matches, and holds probable duplicates for a person to review.

The idea is simple. The difficulty is in handling messy real-world documents, so good tools do several things in sequence.

1. **Extract.** Read the vendor name, invoice number, invoice date and total from the document, whether it is a PDF, a photo or an emailed attachment.
2. **Normalize.** Clean the values so they can be compared. Remove punctuation and prefixes from invoice numbers, standardize vendor names and company suffixes, and convert dates and amounts to a common format.
3. **Match to a vendor.** Link the invoice to an existing vendor record, so that comparison happens against that vendor's full history.
4. **Compare.** Check the new invoice against earlier ones, not only against open bills, because a duplicate often arrives after the first copy was paid and closed.
5. **Score and flag.** Rate how similar the invoice is to an earlier one. An exact match is flagged strongly. A near-match is flagged for review.
6. **Decide.** A person confirms that it is a duplicate, or confirms that it is legitimate. Nothing is posted until then.

### Why comparing against history matters

Some systems only compare a new invoice against items that are still open. Once the first copy has been paid and closed, the second copy has nothing to collide with. Comparing against the full history for that vendor closes this gap, which is also why duplicates so often surface at reconciliation rather than at entry.

### What a flag should look like

A useful flag shows the new invoice next to the earlier one and says why they look alike, for example "same vendor, same amount, invoice number differs by a prefix, dates two days apart". That lets a reviewer decide in seconds. A flag that only says "possible duplicate" creates work instead of removing it.

**How to respond to a duplicate flag**

| What the reviewer finds | Action |
| --- | --- |
| **The same document received twice** | Reject the new copy. Keep the original. |
| **A reminder that includes the original invoice** | Reject the reminder. Keep the original. |
| **A corrected invoice that replaces an earlier one** | Void or credit the earlier one, then approve the corrected invoice. |
| **A genuine repeat, such as a monthly subscription** | Approve as a new invoice. |
| **Two vendor records for one supplier** | Approve once, then merge the vendors. |

## 8. Edge cases: repeats that are not duplicates

> **Short answer:** A good duplicate check must not reject legitimate repeats. Subscriptions, instalment billing, recurring services and corrected invoices all look like duplicates but are not, so they should be reviewed, not blocked.

If a check is too aggressive, people stop trusting it and start approving flags without reading them, which is worse than having no check. These are the cases to design for.

### Subscriptions and recurring bills

A software subscription bills the same vendor, for the same amount, every month. Each invoice has a different date and number and covers a different period. A good check weighs dates and invoice numbers, and routes similar repeats to a person who can confirm the period, rather than rejecting them.

### Instalments and progress billing

A contractor may send equal instalment invoices for the same project. The vendor and amount repeat, but each invoice has a distinct number or milestone. Flag them for review, and make sure the memo or description records the instalment.

### Corrected and re-issued invoices

When a supplier fixes an error, they often send a new invoice with a new number. If both are posted, you have a duplicate. Treat this as a review case: void or credit the original, then approve the corrected version, and keep a note of why.

### Invoices paid by card

An invoice that was already paid by credit card still needs to be recorded, but only once. If you enter it as a bill and the card transaction also arrives through the bank feed, match the feed item to the bill instead of categorizing it as a new expense.

### Statements

A supplier statement lists invoices that you should already have. Use it to reconcile the vendor balance, and enter only the invoices that are missing, never the whole statement.

### Foreign currency and multiple entities

The same invoice may show different amounts in different currencies, and a business with several entities may receive one invoice that belongs to only one of them. Compare in the invoice's original currency, and confirm which entity the invoice belongs to before posting.

## 9. What to do when a duplicate has already been paid

> **Short answer:** Confirm it is a true duplicate, ask the vendor for a refund or a credit note, record the credit so the vendor balance is right, and fix the control that failed so it does not happen again.

1. **Confirm.** Compare the two documents and the two payments. Check the vendor statement to make sure you are looking at a duplicate and not a legitimate repeat.
2. **Contact the vendor.** Write to the vendor with both invoice numbers, both payment dates and amounts, and ask them to refund the duplicate payment or to issue a credit note against future invoices. Keep a record of the request.
3. **Record it properly.** Reverse the duplicate bill, or record a vendor credit, so that expenses and payables are correct. If a refund arrives, match it to the original payment in the bank feed so that the books and the bank agree.
4. **Find the cause.** Use Chapter 2 to identify which cause applied. Did the invoice come through two channels, or was a vendor duplicated?
5. **Fix the control.** Change the process, not only the transaction: close the second channel, merge the vendor records, or add the missing review step.
6. **Tell the client.** Give the client a short note covering what happened, the amount, how it is being recovered and what has changed. Clients value a clear explanation more than silence.

> **A note on tax:** A duplicate bill can inflate input tax credits or sales tax claims if it has already been included in a filing. If the period has been filed, speak with the client's tax adviser about whether an adjustment is needed.

## 10. Where ScanTrix fits

> **Short answer:** ScanTrix is AI invoice scanning for accountants, bookkeepers and small firms. It checks for duplicates before an invoice is posted, requires approval before posting by default, and posts bills to QuickBooks Online or Xero.

ScanTrix is designed around the layers in Chapter 6, so that the software does the checking and the accountant keeps the decision.

- **Layer 1, one intake channel:** invoices come in by photo, upload, email forwarding or from Google Drive, so they can all be checked against the same history.
- **Layer 2, a clean vendor list:** ScanTrix matches each invoice to existing vendors and can create a vendor from inside the app when none exists.
- **Layer 3, detection at capture:** ScanTrix includes duplicate detection that checks an invoice before it is posted.
- **Layer 4, approval before posting:** approval is required by default for the Owner, Admin and Accountant roles, and invoices from the upload-only Contributor role always need approval.
- **Confidence scores:** each invoice is scored, so clear invoices move quickly and uncertain ones are routed for review.
- **Platforms:** ScanTrix connects to QuickBooks Online and Xero, and runs on iOS and the web, with an Android version in beta.

Layer 5, the monthly review, stays with you. Software can reduce what reaches that review, but the review is still where a professional confirms the books.

### Test duplicate detection on one client

ScanTrix starts at $15 per month, and founding members receive 50% off. The founding offer is limited to the first 30 members. Run the audit in Chapter 5 on one client first, then compare the results after a month with ScanTrix.

[Start your pilot](/register) · [Ask a question](mailto:${SUPPORT_EMAIL}?subject=ScanTrix%20duplicate%20detection%20question)

## Frequently asked questions

### What is a duplicate invoice?

A duplicate invoice is a second record of an obligation that has already been recorded or paid. It can be an identical copy of the same document, or a near-duplicate with a different invoice number, format or vendor name that refers to the same purchase.

### How do I find duplicate bills in QuickBooks Online?

Run a bills or expenses report grouped by vendor, sort by amount and date, and look for the same vendor and amount within a short window. Also check the vendor list for near-identical vendor names, and review bank-feed transactions that were categorized as expenses when a matching bill already exists.

### How do I find duplicate bills in Xero?

Export bills for the period, sort by contact, amount and date, and look for repeats. Check the contact list for duplicate suppliers, and review bank statement lines that were coded as spend transactions when a bill for the same amount already exists.

### Why does the same invoice get entered twice?

The most common reasons are that the invoice arrives through more than one channel, such as email and a client upload, that a supplier sends a reminder or statement, that the vendor exists twice in the system, or that a bill is entered and the matching bank transaction is also categorized as an expense.

### Does QuickBooks or Xero stop duplicate invoices automatically?

Both can warn when a bill number is reused for the same vendor, but this only works when the number is entered identically. It does not reliably catch a different invoice number, a second vendor record, a statement line, or a bill that was also entered as a bank-feed expense. Test the behaviour in your own file.

### What is a near-duplicate or fuzzy duplicate invoice?

A near-duplicate refers to the same purchase but differs in at least one field, for example an invoice number written as INV-5521 in one copy and 5521 in another, or a vendor name spelled two ways. Exact-match checks miss these, while fuzzy matching compares fields after normalizing them.

### How much do duplicate payments cost?

APQC benchmarking data reported by CFO.com found that even top-performing organizations had about 0.8% of annual disbursements that were duplicate or erroneous, and bottom performers had more than 2%. The cost for your own clients depends on invoice volume and average value, so calculate it from your own data.

### What should I do when I find a duplicate that has already been paid?

Confirm it is a true duplicate, contact the vendor to request a refund or a credit note, record the credit in the books so the vendor balance is correct, and note the cause so the control that failed can be fixed.

### Is a recurring subscription charge a duplicate?

No. A subscription that bills monthly produces similar invoices with the same vendor and amount, but each covers a different period. A good duplicate check compares dates and invoice numbers, and sends similar-looking repeats to a person to confirm rather than rejecting them.

### How can AI help prevent duplicate invoices?

AI invoice tools extract the vendor, number, date and amount at the moment an invoice arrives and compare them with earlier invoices, including near-matches. Probable duplicates are flagged for a person to review before anything is posted.

### Who is responsible for catching duplicate invoices, the client or the bookkeeper?

Responsibility should be agreed in writing. Bookkeepers usually own the detection and review steps, while clients are responsible for not paying invoices outside the agreed process. A single intake channel and approval before posting make the split clear.

### How often should I check for duplicates?

Check at capture for every invoice, review flagged items weekly, and run a duplicate review as part of every month-end close. Review the vendor list for duplicate vendor records at least quarterly.

## Glossary

**Accounts payable (AP)**
Money a business owes to its suppliers for goods and services received, tracked from invoice to payment.

**Bank feed**
A connection that brings bank and card transactions into accounting software automatically.

**Bill**
The record in accounting software that represents an unpaid supplier invoice.

**Credit note (credit memo)**
A document from a supplier that reduces the amount owed, for example after a return, a correction or an overpayment.

**Duplicate invoice**
A second record of an obligation that has already been recorded or paid.

**Duplicate payment**
A payment that settles an obligation that has already been paid.

**Fuzzy matching**
Comparing values that are similar but not identical, after cleaning them into a standard form, to find near-duplicates.

**Near-duplicate**
A document that refers to the same purchase as an earlier one but differs in at least one field.

**Normalization**
Converting values such as invoice numbers, vendor names and dates into a consistent format so they can be compared.

**Segregation of duties**
Splitting tasks such as approving suppliers, approving invoices and making payments among different people.

**Vendor master file**
The list of supplier records a business uses. In QuickBooks Online it is the vendor list, and in Xero it is the contact list.

## Sources

- Wiggins, P. D., CPA (APQC). "Metric of the Month: Detect and Prevent Duplicate or Erroneous Payments." CFO.com, 2020. Reports APQC Open Standards Benchmarking Accounts Payable data on duplicate or erroneous disbursements. [cfo.com](https://www.cfo.com/accounting-tax/2020/03/metric-of-the-month-detect-and-prevent-duplicate-or-erroneous-payments/)

Benchmark figures are cited as published and may have changed. The illustrative example in Chapter 3 is not a benchmark.

## Questions about your own setup?

Write to [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}) and describe your accounting platform and how many clients you support.

*© 2026 ScanTrix Technologies Inc. All rights reserved. This guide is general information for accounting professionals and is not tax, legal or investment advice. QuickBooks is a trademark of Intuit Inc. Xero is a trademark of Xero Limited. ScanTrix is not affiliated with or endorsed by Intuit or Xero. Last updated October 23, 2026.*
`;
