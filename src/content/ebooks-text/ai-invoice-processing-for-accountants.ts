import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from "@/lib/legal";

// The in-site reading copy of "AI Invoice Processing for Accountants". Same text
// as the downloadable PDF (public/ebooks/ai-invoice-processing-for-accountants.pdf).
// Markdown, rendered by renderMarkdown in src/lib/blog.ts; no H1 (the page title
// is the H1) and chapters start at "##".
export const body = `
## The short version

- **AI invoice processing** reads supplier invoices, pulls out the vendor, dates, amounts and tax, suggests a category, and prepares a bill for QuickBooks Online or Xero.
- The risk is not the AI reading an invoice wrong. The risk is a tool that **posts to your books without showing its work**.
- Safe automation has three parts: a **confidence score** on every extraction, **approval before posting**, and an **audit trail**.
- Start with one or two clients, review results weekly, and widen automation only where the numbers earn it. Most small firms can complete this in about 30 days.
- This guide covers the definition, the workflow, the controls, a 10-question buying checklist, a rollout plan and answers to common questions.

## 1. What is AI invoice processing?

> **Short answer:** AI invoice processing is software that reads a supplier invoice, extracts the key fields, suggests how it should be coded, and prepares it for posting to your accounting software, while a person approves anything the software is unsure about.

An invoice arrives as a PDF in an inbox, a photo from a phone, or a paper copy on a desk. Someone has to work out who sent it, what it is for, how much tax is on it, which account it belongs in, and whether it has already been entered. Traditionally that someone is a bookkeeper typing it all in by hand.

AI invoice processing, sometimes called invoice scanning, invoice capture or accounts payable automation, takes over the typing and the first pass of judgment. The bookkeeper moves from entering data to reviewing exceptions.

### How is this different from OCR?

Optical character recognition (OCR) only turns an image into text. It does not know that one string of digits is an invoice number and another is the total. AI invoice processing adds understanding on top: it identifies each field, handles layouts it has never seen, suggests a general ledger (GL) account, and checks the result against what is already in your books.

**OCR compared with AI invoice processing**

| Capability | Basic OCR | AI invoice processing |
| --- | --- | --- |
| Reads text from an image | Yes | Yes |
| Knows which text is the vendor, date, total and tax | Only with fixed templates | Yes, across varied layouts |
| Suggests an expense category | No | Yes |
| Flags duplicates | No | Yes |
| Shows how sure it is | No | Yes, with a confidence score |
| Prepares a bill in QuickBooks Online or Xero | No | Yes |

> The goal is not to remove people from accounts payable. It is to put their attention only where it is needed.

## 2. What manual invoice entry really costs

> **Short answer:** The cost of manual invoice entry is not just the minutes spent typing. It includes data-entry errors, duplicate payments, delayed month-end close, and the opportunity cost of skilled people doing clerical work.

Every firm can measure its own version of this. The categories are the same everywhere:

- **Keying time.** Opening, reading and typing each invoice, then attaching the source document.
- **Error correction.** Transposed digits, wrong tax codes and miscoded accounts that surface weeks later during reconciliation or review.
- **Duplicates.** The same invoice arrives by email and again as a statement line or a reminder, and gets entered twice.
- **Chasing.** Asking clients for missing invoices, unclear photos and supporting documents.
- **Late close.** Month-end waits on whoever has the backlog.
- **Opportunity cost.** Hours spent on data entry are hours not spent on advisory work you could bill for.

### How to measure your own baseline

Before you change anything, spend one week recording three numbers: how many invoices you process, the average minutes per invoice from receipt to posted, and how many need correction afterwards. Multiply invoices by minutes by your effective hourly cost. That figure is your baseline, and it is the number a pilot should beat.

> **Tip:** Count correction time separately. Firms often find that rework, not first-pass entry, is the larger share of the true cost.

## 3. How AI invoice scanning works, step by step

> **Short answer:** An AI invoice tool captures the document, extracts its fields, matches the vendor, suggests an account, scores its own confidence, routes the invoice for review or approval, and then posts the bill to QuickBooks Online or Xero.

The order below is a real sequence, and each step is an opportunity for a control.

1. **Capture.** The invoice reaches the tool by photo, file upload, a forwarding email address, or a cloud folder such as Google Drive. Good capture accepts whatever your clients already send.
2. **Extraction.** The software reads vendor name, invoice number, invoice date, due date, subtotal, tax and total, and the line items where present.
3. **Vendor matching.** The extracted vendor is matched to an existing vendor in your accounting software. If none exists, a new vendor can be created. Matching to existing records is what prevents a messy vendor list.
4. **Categorization.** The tool suggests a GL account, using the vendor's history and the invoice content.
5. **Duplicate check.** The invoice is compared with earlier ones by vendor, number, date and amount before it goes any further.
6. **Confidence score.** The tool rates how sure it is about the extraction and coding, which decides how much human attention the invoice needs.
7. **Review and approval.** A person confirms or corrects the invoice. Approval rules decide who is allowed to approve.
8. **Posting.** The approved invoice becomes a bill in QuickBooks Online or Xero, with the original document attached.

If a tool skips steps 6 and 7, it is not automating accounts payable, it is automating risk. The next two chapters explain why those steps matter most.

## 4. Confidence scores: automation you can trust

> **Short answer:** A confidence score tells you how sure the software is about an invoice. It lets you automate the clear cases, review the uncertain ones, and enter the unreadable ones by hand, so that effort follows risk.

No extraction system is right every time. Scans are crooked, suppliers invent layouts, and handwriting happens. What separates a trustworthy tool from a risky one is whether it knows when it might be wrong and says so.

**A three-tier confidence model (as used in ScanTrix)**

| Confidence | What it means | What happens next |
| --- | --- | --- |
| **90% and above** | Fields are clear and the vendor and coding are familiar. | Eligible for automatic posting, if you have turned that on. Otherwise it goes to a fast approval. |
| **70% to 89%** | Most fields are clear, but something such as the GL account or a date needs a look. | Sent for review. A person checks the flagged field and approves. |
| **Below 70%** | The scan is poor or key fields could not be read. | Manual entry. Nothing is posted automatically. |

### Why a confidence score beats a headline accuracy claim

An accuracy percentage on a marketing page describes an average across someone else's invoices. A confidence score describes *this* invoice, in front of you, right now. It is the difference between a vendor promising that most invoices are fine and a tool that tells you which one is not.

### How to use the tiers in practice

- Start with automatic posting **off**. Review everything for the first two weeks.
- Track how often your corrections fall in each tier. If high-confidence invoices almost never need changes, you have evidence for loosening the rules.
- Keep new vendors and unusually large amounts in review regardless of score.

## 5. Approvals, roles and audit trails

> **Short answer:** Safe invoice automation requires approval before posting, roles that limit who can post, and an audit trail that records who approved what and when.

Accounts payable is where money leaves the business, so it is where internal controls matter most. Three controls cover most of the risk.

### Approval before posting

Nothing should reach the general ledger until a person with the right authority has approved it. In ScanTrix, approval before posting is required by default for the Owner, Admin and Accountant roles. A bypass exists only through an explicit trusted setting that you choose to enable.

### Roles that match how work really happens

Clients, assistants and junior staff often need to submit invoices but should not be able to post them. An upload-only role solves this. In ScanTrix, a Contributor can submit invoices by photo, upload or email forwarding, and every invoice from a Contributor always requires approval, with no bypass.

**Example role design for a small firm**

| Role | Can upload | Can approve | Can post to the books |
| --- | --- | --- | --- |
| **Client or assistant (Contributor)** | Yes | No | No, always needs approval |
| **Bookkeeper (Accountant)** | Yes | Yes | After approval |
| **Firm owner or admin** | Yes | Yes | After approval |

### An audit trail you can show a reviewer

When an auditor, a partner or a client asks why an invoice was coded a particular way, you should be able to show the original document, the extracted fields, any corrections, and who approved it. Each of those should be recorded automatically, not reconstructed from memory.

> **A note on professional responsibility:** Software can prepare and suggest, but the accountant remains responsible for the books. Choose tools that make review easy rather than tools that make it optional.

## 6. Duplicates, vendors and coding

> **Short answer:** Clean books depend on three habits that a good tool builds in: catching duplicate invoices before they post, matching to existing vendors instead of creating new ones, and coding consistently to your chart of accounts.

### How do you stop duplicate invoices?

Duplicates come from the same invoice arriving twice, by email and again as a reminder or a forwarded copy. The safe approach is to compare every new invoice against earlier ones on vendor, invoice number, date and amount, and to flag likely matches for a person instead of silently posting or silently discarding. ScanTrix includes duplicate detection for exactly this reason.

### How do you keep the vendor list clean?

"Amazon Web Services", "AWS" and "Amazon Web Services Inc." should be one vendor, not three. A tool should match against vendors already in QuickBooks Online or Xero and only create a new one when no sensible match exists. Creating vendors from inside the tool, when needed, saves a trip into the accounting software.

### How does automatic categorization work?

Categorization suggests a GL account from the vendor's history and what the invoice says. It improves as it sees your patterns, but the suggestion is only a starting point. Your chart of accounts remains the source of truth, and a person should be able to change any suggestion in one step.

### Getting invoices in without friction

Collection is where many rollouts stall. Look for several routes in: photographing a paper invoice, uploading a file, forwarding an email to a dedicated address, and saving from a cloud folder such as Google Drive. Clients adopt the route that costs them the least effort.

## 7. How to choose an AI invoice tool: 10 questions

> **Short answer:** Choose a tool that integrates with your accounting platform, shows confidence scores, requires approval before posting, detects duplicates, supports roles, keeps an audit trail and is open about how it handles your data.

Use this checklist when comparing vendors. A tool that cannot answer "yes" to the first six is not ready for client work.

**Buyer's checklist for AI invoice processing**

| Question to ask | What a good answer looks like |
| --- | --- |
| **1. Does it post to the platform I use?** | A direct integration with QuickBooks Online and/or Xero, not a CSV you must import. |
| **2. Does it show confidence for each invoice?** | A visible score and clear tiers that decide what is reviewed. |
| **3. Is approval required before posting?** | Yes by default, with any bypass an explicit, reversible setting. |
| **4. How does it handle duplicates?** | Flags probable duplicates for review before anything is posted. |
| **5. Does it use my existing vendors and chart of accounts?** | Matches to what is already in the books and lets you change suggestions. |
| **6. Can people be limited to upload-only?** | A role that submits invoices but cannot post them. |
| **7. Is there an audit trail?** | A record of source document, corrections and approver. |
| **8. How do invoices get in?** | Photo, upload, email forwarding and cloud folder, on mobile and web. |
| **9. What happens to my data?** | Plain statements on storage location, retention and whether customer data is used to improve AI responses. |
| **10. What does it cost, and can I start small?** | Simple per-user pricing and a pilot that does not need a long contract. |

## 8. A 30-day rollout plan

> **Short answer:** Pilot with one or two clients in week one, review every invoice for two weeks, then widen to more clients and loosen review only where your own correction data supports it.

This plan suits a freelance bookkeeper or a small firm. The weeks are a sequence, so they are numbered.

1. **Week 1: Baseline and pilot setup.** Record your current numbers (invoices, minutes per invoice, corrections). Connect your accounting software. Choose one or two friendly clients with steady invoice volume. Keep automatic posting off.
2. **Week 2: Review everything.** Run real invoices through the tool and approve each one. Note every correction and which confidence tier it came from. Agree with each pilot client how they will send invoices.
3. **Week 3: Compare and tune.** Compare minutes per invoice and corrections with your baseline. Fix recurring coding issues at the vendor level. Add the next few clients and set up upload-only access where clients submit their own invoices.
4. **Week 4: Decide what to automate.** Look at the correction data by confidence tier. If high-confidence invoices from known vendors rarely change, consider allowing automatic posting for that group only. Keep new vendors and large amounts in review. Write down your rules so they are consistent across clients.

### Metrics worth tracking

- Average minutes from receipt to posted, per invoice.
- Share of invoices needing correction, by confidence tier.
- Duplicates caught before posting.
- Days from month-end to close.

## 9. Where ScanTrix fits

> **Short answer:** ScanTrix is AI invoice scanning built for accountants, bookkeepers and small firms. It reads invoices, scores its own confidence, asks for approval before posting, and posts bills to QuickBooks Online or Xero.

ScanTrix was designed around the principles in this guide: the software does the typing, and the accountant keeps the decision.

### What ScanTrix does today

- **Scans invoices** by photo or upload, and accepts invoices by email forwarding or from Google Drive.
- **Scores confidence** on each invoice using a three-tier model: automatic, review, manual.
- **Categorizes** invoices automatically and lets you correct any suggestion.
- **Detects duplicates** before they are posted.
- **Creates vendors and GL accounts** from within the app when needed.
- **Requires approval before posting** by default, with an upload-only Contributor role for clients and staff.
- **Connects to QuickBooks Online and Xero.**
- **Runs on iOS and the web**, with an Android version in beta.

### Who it is for

ScanTrix is built first for freelance accountants and bookkeepers and for small accounting firms that handle accounts payable for several clients and want to spend less time keying and more time reviewing.

### Your data

ScanTrix is a Canadian company and is open about how it stores and handles customer data. Read the current [terms](${TERMS_URL}) and [privacy policy](${PRIVACY_URL}) for retention, storage location and AI-use details before you connect client books.

### Try it on one client first

ScanTrix starts at $15 per month, and founding members receive 50% off. The founding offer is limited to the first 30 members. Run a pilot the way Chapter 8 describes and judge it by your own numbers.

[Start your pilot](/register) · [Ask a question](mailto:${SUPPORT_EMAIL})

## Frequently asked questions

### What is AI invoice processing?

AI invoice processing is software that reads supplier invoices (PDFs, photos or emailed attachments), extracts the vendor, dates, amounts and line items, suggests an accounting category, and prepares the bill for posting to accounting software such as QuickBooks Online or Xero, with a human approving anything the software is not confident about.

### Is AI invoice scanning accurate enough for accounting work?

It is accurate enough when the tool shows a confidence score for every extraction and routes low-confidence invoices to a person. Accuracy depends on invoice quality, so the control that matters is not a headline accuracy percentage but whether you can see, review and correct every field before it reaches your books.

### Does AI invoice processing work with QuickBooks Online and Xero?

Yes. ScanTrix connects to both QuickBooks Online and Xero. Always confirm that a tool posts bills to the accounting platform you use, and that it uses your existing vendors and chart of accounts rather than creating duplicates.

### What is the difference between OCR and AI invoice processing?

OCR only converts an image into text. AI invoice processing goes further: it understands which text is the vendor, the invoice date, the total and the tax, suggests a general ledger account, checks for duplicates and prepares a bill for your accounting software.

### Will AI invoice processing replace bookkeepers?

No. It removes repetitive data entry so that bookkeepers and accountants spend their time on review, exceptions, client advice and month-end close. Judgment calls, such as unusual coding or a suspicious invoice, stay with a person.

### How do I stop duplicate invoices from being posted?

Use a tool that checks each new invoice against previous ones by vendor, invoice number, date and amount before posting, and that flags probable duplicates for review instead of silently posting them.

### How long does it take to roll out AI invoice processing?

A freelance bookkeeper or small firm can usually run a pilot with one or two clients within a week and be fully rolled out across clients in about 30 days, as long as the pilot is reviewed weekly and the review rules are adjusted along the way.

### How do I keep control of what gets posted to the books?

Require approval before posting by default, assign roles so that upload-only users cannot post, and keep an audit trail of who approved what. Only allow automatic posting for high-confidence invoices from known vendors, and only after a pilot has shown it is reliable.

### Can clients upload invoices without access to my accounting software?

Yes, in ScanTrix. A Contributor role is upload-only: clients or staff can submit invoices by photo, upload or email forwarding, and every invoice still requires approval before it is posted.

### What should I look for when choosing an AI invoice tool?

Check that it integrates with your accounting platform, shows confidence scores, requires approvals before posting, detects duplicates, uses your existing vendors and chart of accounts, supports roles, keeps an audit trail, and is transparent about how your data is stored and used.

## Glossary

**Accounts payable (AP)**
Money a business owes to its suppliers for goods and services received, tracked from invoice to payment.

**AI invoice processing**
Software that extracts data from invoices, suggests coding and prepares bills for accounting software. Also called invoice capture or invoice scanning.

**Approval workflow**
A rule set that decides who must approve an invoice before it is posted or paid.

**Audit trail**
An automatic record of each action taken on an invoice, including edits and approvals.

**Bill**
The record in accounting software that represents an unpaid supplier invoice.

**Chart of accounts**
The structured list of accounts a business uses to categorize transactions.

**Confidence score**
A percentage showing how sure the software is about an extraction, used to decide how much human review an invoice needs.

**Duplicate detection**
Checking a new invoice against earlier ones to avoid recording or paying the same invoice twice.

**General ledger (GL) account**
An individual account in the chart of accounts to which a transaction is coded.

**OCR (optical character recognition)**
Technology that converts an image of text into machine-readable text, without understanding what the text means.

**QuickBooks Online (QBO)**
Cloud accounting software from Intuit, widely used by small businesses and bookkeepers.

**Xero**
Cloud accounting software used by small businesses and accounting practices.

## Questions about your own setup?

Write to [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}) and describe your accounting platform and how many clients you support.

*© 2026 ScanTrix Technologies Inc. All rights reserved. This guide is general information for accounting professionals and is not tax, legal or investment advice. QuickBooks is a trademark of Intuit Inc. Xero is a trademark of Xero Limited. ScanTrix is not affiliated with or endorsed by Intuit or Xero. Last updated October 23, 2026.*
`;
