# Email forwarding — setup guide

For the accountant using Scantrix. Two minutes to set up, once per company.

---

## What it does

Every QuickBooks company gets its own email address. Forward a supplier invoice
to it and it lands in Scantrix exactly as if you had uploaded the file by hand —
same reading, same vendor matching, same duplicate checks, same review before
anything is posted.

No downloading. No re-uploading. No choosing which company.

---

## Turn it on

1. Go to **Integrations** (the accounting-software page).
2. Click the QuickBooks company you want — its panel opens on the right.
3. Scroll to **Email forwarding**.
4. Click **Turn on email forwarding**.
5. Copy the address. It looks like:

   ```
   acme-corp-7k2m9x@invoice.scantrix.ai
   ```

Save it as a contact in your mail client. You will paste it a lot.

**Repeat for each company.** Five companies means five addresses — that is how
the system knows which books an invoice belongs to, so you never pick at the
moment of forwarding.

> **The first person to turn it on for a company must be its owner or admin.**
> After that, anyone with access can create their own address for it.

---

## Use it

Forward the supplier's email to that company's address. That's the whole thing.

The invoice appears in your normal review queue within about a minute, marked
**Email** in the list so you can always tell how a document arrived.

**Attach the file.** An invoice that arrives as a *download link* in the message
body is ignored — links are never opened, deliberately, because following links
from email is how bad things get into a finance system. If a supplier sends a
link, save the file and attach it.

---

## Who is allowed to send

Only addresses you have authorised. Everyone else is discarded silently.

By default that is **your own account email**. To let a colleague forward
invoices too:

1. **Integrations → the company → Email forwarding**
2. Under the sender list, type their address and click **Add**

Each person who sets up forwarding gets their **own** address with its own sender
list, so team members never see each other's inbound mail.

---

## What can be sent

| | |
|---|---|
| Formats | PDF, or an image (JPEG, PNG, HEIC, TIFF, WebP) |
| Attachments per email | Up to 10 |
| Size | 15 MB per file, 40 MB per email |
| Ignored automatically | Signature logos, tracking pixels |
| Never accepted | Programs, scripts, archives, macro-enabled Office files |

Photos of paper invoices work. So do scans.

---

## Checking what happened

**Integrations → the company → Email forwarding → Recent email imports.**

Every message is listed with a plain reason. Nothing fails silently.

| What you see | What to do |
|---|---|
| **1 invoice** | Done — it's in your review queue |
| **Sender not allowed** | Forwarded from an unauthorised mailbox. Add it to the sender list, or forward from an approved one |
| **No invoice attachment found** | The invoice was a link, not a file. Save it and attach it |
| **Attachment wasn't a PDF or an image** | Re-save as PDF and resend |
| **The email failed sender authentication checks** | The message couldn't be confirmed as genuinely from that sender — usually an unusual mail relay in between |
| **Email forwarding lost access to this company** | Click **Reconnect** in the same panel. The address does not change |
| **Queued** | Forwarding is switched off server-side. Contact support |

---

## Changing or stopping an address

Both live in the same panel.

**Generate a new address** — use if an address starts attracting spam.
**The old address stops working immediately**, so update any saved contacts and
any supplier auto-forwarding rules first.

**Turn off email forwarding** — the address stops accepting mail at once.
Invoices already imported are unaffected, and uploading by hand is completely
unaffected either way.

---

## Things worth knowing

**Sending the same invoice twice does not create two bills.** Duplicates are
detected the same way they are for uploads.

**Nothing posts to QuickBooks on its own** that wouldn't already post from an
upload. Your existing review and approval rules govern.

**Invoices show as uploaded by "Email Forwarding".** That's the system account
that files them. The person who actually forwarded the email is recorded in
Recent email imports.

**"Received" is when Scantrix processed it,** not when the email was originally
sent. Forward a month-old invoice and it will still say it arrived just now.

**A delivery is never lost.** If anything is briefly unavailable, the mail
provider re-sends for up to about 32 hours until it goes through.

---

## Troubleshooting

**Nothing arrived at all.**
Check the address character for character — a typo goes nowhere and you get no
bounce. Then check **Recent email imports**: if the message isn't listed, it
never reached us; if it is, the reason is there.

**"Only an owner or admin can turn on email forwarding."**
You're a contributor or accountant on this company and nobody has set it up yet.
Ask an owner to enable it once; after that you can create your own address.

**"Reconnect this company to QuickBooks first."**
The QuickBooks connection is broken or needs re-authorising. Fix that on the same
page, then turn on forwarding.

**It worked before and stopped.**
Open the panel. If it says **Needs reconnect**, click **Reconnect** — one click,
the address is unchanged.
