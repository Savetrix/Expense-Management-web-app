import type { BlogPostSource } from "@/lib/blog";

// Targets SEO-AUDIT.md §4 cluster 5: "forward supplier invoices to
// QuickBooks", "email invoices directly into accounting software".
//
// Every safeguard described here is implemented in src/lib/inboundEmail:
// sender allow-list (authorization.ts), SPF/DKIM/DMARC verdicts
// (authResults.ts), content-vs-type checks and provider virus verdicts
// (attachment.ts, scanVerdict.ts). Exact size limits are deliberately left out:
// they are configuration, and a number printed in a blog post outlives them.
export const post: BlogPostSource = {
  slug: "forward-supplier-invoices-to-quickbooks-by-email",
  title: "How to forward supplier invoices to QuickBooks by email",
  description:
    "Set up email forwarding for supplier invoices without opening a security hole: one address per company, approved senders and checks on every file.",
  publishedAt: "2026-09-30",
  category: "Workflow",
  tags: ["Email forwarding", "QuickBooks Online", "Security"],
  author: "Scantrix Team",
  body: `
Almost every supplier invoice already arrives by email. Yet in many finance teams, the next step is still download the PDF, find the right company, upload it, and delete the download. It is only a few clicks, but it happens hundreds of times a month, and every download that isn't cleaned up is a copy of a financial document sitting on a laptop.

Forwarding removes that step. You forward the email to an address, and the invoice lands in the right set of books. Done carelessly, though, an invoice address is also a new way into your accounts. This guide covers how to get the convenience without the risk.

## Why forwarding beats download-and-upload

- **Fewer steps.** Forwarding takes one action, from any mail app, including on a phone.
- **No stray copies.** Nothing is saved to a downloads folder or a desktop.
- **Nothing gets stuck in a personal inbox.** If the whole team forwards to the same place, invoices stop depending on who happened to receive them.
- **It is hard to get wrong,** provided the address itself decides where the invoice goes.

That last point matters most when you keep books for more than one company.

## The multi-company problem

An accountant with twelve clients has twelve sets of books. If every invoice goes to one inbox, someone has to decide, every time, which client it belongs to. A dropdown at upload time is exactly where a bill ends up in the wrong company's books.

The reliable fix is **one forwarding address per company**. The address *is* the choice: forward a supplier's invoice to that client's address and it can only land in that client's books. Nobody picks from a list while half-reading an email.

Pick addresses you can tell apart at a glance: \`acme-bills@…\` is harder to confuse than a string of random characters.

## What makes a forwarding address safe

An address that turns email into bills is an entry point into your accounts, so it deserves the same care as a login. These are the safeguards to insist on:

### Only approved senders

The address should accept mail only from people you have listed, such as your own staff, and discard everything else. Discarding it silently matters too: a bounce message confirms to a spammer that the address is live.

### Sender authentication on every message

The "From" line of an email is trivially forged. The real check is the sender's domain records, known as **SPF**, **DKIM** and **DMARC**, which let a receiving server confirm that a message really came from the domain it claims to. A safe forwarding service checks these on every message, so a forged email that merely *says* it's from your colleague is refused.

### Files judged by their contents, not their names

A file called \`invoice.pdf\` can contain anything. Attachments should be identified by what they actually contain and scanned for viruses before anything is read or stored.

### Links are never followed

"Click here to download your invoice" is one of the oldest phishing techniques. A forwarding service should only ever process attached files, never open links in the message body. If a supplier only sends links, download the invoice yourself and upload it.

### The same rules as a manual upload

Forwarding should be a new way *in*, not a shortcut past your process. A forwarded invoice should be read, matched and reviewed exactly like one you uploaded by hand.

### An address you can replace

If an address leaks or starts attracting spam, you should be able to generate a new one in seconds, and the old one should stop working immediately.

## Setting it up in Scantrix

[Scantrix](/#email) builds each of the safeguards above into email forwarding for QuickBooks Online. Setup takes a couple of minutes per company:

1. **Connect the QuickBooks company** you want invoices to go to.
2. **Open Integrations** in Scantrix and choose **Turn on email forwarding** for that company.
3. **Choose a custom username** if you want a memorable address, then copy it.
4. **Add the colleagues who may forward.** Your own address is already on the sender list; add anyone else who will forward invoices for this company.
5. **Forward a test invoice.** It appears in the company's recent email imports within moments, with a clear reason if anything was rejected.

Repeat for each company. Five clients means five addresses, and that is the point.

## Tips for forwarding that just works

- **Forward normally, not "as attachment".** Some mail apps, Outlook in particular, can forward a message *as an attachment*, which nests the invoice inside another email. Use the ordinary Forward button.
- **Several invoices in one email is fine.** Each attachment is handled on its own, so one unreadable file doesn't hold up the rest.
- **Logos and signature images are ignored.** Small inline images in an email's design are not mistaken for invoices.
- **PDFs and images both work.** A photo of a paper invoice, forwarded from a phone, is handled like a PDF.
- **Keep an eye on the activity list.** Every rejected message says why: an unapproved sender, a failed authentication check, a file that isn't really a PDF. Most rejections are fixed in one step.

## Should suppliers send to the address directly?

They can: add the supplier's billing address to the approved list and their invoices arrive with no forwarding step at all. Many teams still prefer to keep the list to their own staff and forward, so every invoice passes through a person's inbox first. Both are reasonable. The approved-sender list is what makes either one safe.

Once invoices arrive in one place, the next bottleneck is usually cadence. Our guide to [clearing a month-end accounts payable backlog](/blog/clear-month-end-accounts-payable-backlog) covers the weekly routine that keeps them from piling up.
`,
};
