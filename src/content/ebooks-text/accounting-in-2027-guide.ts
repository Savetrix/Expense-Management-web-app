import { SUPPORT_EMAIL } from "@/lib/legal";

// The in-site reading copy of "Accounting in 2027: Apps to Connect and How to Use
// Claude". Same text as the downloadable PDF (private/ebooks/accounting-in-2027-guide.pdf).
// Markdown, rendered by renderMarkdown in src/lib/blog.ts; no H1 (the page title is
// the H1) and chapters start at "##".
export const body = `
## The short version

- In 2027, the strongest accounting setups will be a **small set of connected apps with a person reviewing the output**, not one tool that does everything.
- Claude now connects to accounting data through **connectors**, with Xero's connector read-only at launch and Intuit's QuickBooks connector extending into sales, payroll and lending, so check which actions your own setup allows before relying on it.
- The best results from Claude come from giving it **context, the right data and a defined output**, then verifying the answer against the source records.
- Client data needs a deliberate plan choice, a written AI policy and professional skepticism, because CPA Ontario applies the same professional obligations to AI as to any other software.
- A **90-day rollout** that starts with one workflow, such as invoice capture, beats a firm-wide switch on day one.

## 1. What will accounting work look like in 2027?

> **Short answer:** Accounting in 2027 will look like today's workflow with more of the repetitive steps handled by software: capture, coding, drafting and first-pass analysis. Accountants will spend more time reviewing, explaining and advising. The shift is gradual and tool by tool, so the practical question is which steps you automate first.

Predictions about accounting are easy to make and hard to check, so this chapter sticks to developments you can already see. Three are worth planning around: assistants that connect to your ledger, structured e-invoicing that is spreading internationally, and a professional framework that expects people to stay accountable for AI-assisted work.

### What is changing in the tools?

General-purpose AI assistants are moving from chat windows into the places accountants already work. Anthropic describes [Claude for Excel](https://www.anthropic.com/news/advancing-claude-for-financial-services) as a sidebar in Microsoft Excel where Claude can read, analyze, modify and create workbooks. It was released as a research preview in October 2025, so check current availability for your plan. Intuit announced in April 2026 that its QuickBooks and other apps are available inside Claude. Xero publishes its own connector for Claude. The pattern is the same each time: the assistant goes to the data instead of the data being pasted into the assistant.

### Is e-invoicing becoming mandatory in Canada?

As of the sources reviewed for this guide, Canada has no mandatory business-to-business e-invoicing requirement. Xero's Canadian guide says the Canada Revenue Agency is actively studying e-invoicing for GST/HST compliance and that Canada joined the Peppol network in 2023. Many other countries are further along. For a Canadian practice, the sensible move is to watch the CRA and prefer software that can already handle structured invoice data, without assuming a mandate date.

### What stays the same?

Your professional obligations do not change. CPA Ontario states that the same obligations that govern any software apply to AI, and that members must apply professional skepticism so that reliance on AI does not lead to unverified conclusions. A faster first draft does not shorten the review.

**Where AI is changing accounting work, and where a person stays in control**

| Work area | What software can take over | What the accountant still owns |
| --- | --- | --- |
| **Invoice and receipt capture** | Reading documents and proposing vendor, amounts and accounts | Approving what posts to the ledger |
| **Reporting and analysis** | Pulling reports, drafting commentary, spotting unusual items | Checking numbers to source and deciding what matters to the client |
| **Spreadsheet work** | Building and fixing formulas, restructuring workbooks | Model logic, assumptions and sign-off |
| **Client communication** | First drafts of emails, requests and summaries | Tone, accuracy and what is shared |
| **Compliance and filings** | Checklists and working-paper drafts | Technical positions and professional judgment |

> The question for 2027 is not whether to use AI. It is which steps to hand over first, and who checks the result.

## 2. Which apps belong in a 2027 accounting stack?

> **Short answer:** A workable stack has six layers: a ledger such as QuickBooks Online or Xero, a capture tool for invoices and receipts, a bank-data feed, document storage, a spreadsheet, and an AI assistant such as Claude. Add automation and practice-management tools only when a specific bottleneck justifies them. Fewer, well-connected apps beat a long list.

Most practices do not need more software. They need the software they have to pass information along cleanly. Think in layers, and decide for each layer whether you already have an answer.

**The layers of a connected accounting stack**

| Layer | Job it does | Examples | Integration to look for |
| --- | --- | --- | --- |
| **Ledger** | Single source of truth for transactions | QuickBooks Online, Xero | Stable API, clear permissions, audit trail |
| **Capture** | Turns invoices and receipts into bills | ScanTrix | Posts to the ledger with an approval step |
| **Bank data** | Brings in transactions for matching | Bank feeds inside the ledger | Same feed used by one tool only, to avoid duplicates |
| **Documents** | Stores source files and working papers | Google Drive, Microsoft 365 | Folder structure that matches clients and years |
| **Spreadsheet** | Analysis, schedules, reconciliations | Excel, Google Sheets | Imports from the ledger without retyping |
| **AI assistant** | Drafting, analysis, explanation, review support | Claude | Connectors to the ledger and documents, with permissions you control |

### Which layer should you fix first?

Start where you re-key the most data by hand. For most small practices that is invoice and bill entry, because every client sends documents in a different form. Fixing capture also improves everything downstream: reports are more current, reconciliations are shorter and the assistant has cleaner data to read.

### When do you need an automation platform?

Automation platforms such as Make or Zapier connect apps that have no direct integration. They are useful for routing, reminders and notifications. They also add another system holding client data and another place for a workflow to fail silently. Add one only after the direct integrations are in place, and document what each automation does.

### What about all-in-one systems?

An all-in-one platform reduces the number of connections to manage, but it ties your workflow to one vendor's pace of improvement. A connected stack lets you replace a single layer without rebuilding the rest. Neither answer is right for every practice; the test is whether you can export your data and switch a layer in a weekend rather than a quarter.

> **Tip:** Draw your current stack on one page, with an arrow for every place a person copies data from one app into another. Each arrow is a candidate for integration.

## 3. How do you decide which apps to integrate?

> **Short answer:** Score each candidate app on eight questions: what job it does, whether it connects directly to your ledger, who approves what it posts, where data is stored, how permissions work, what it costs at your client count, how you export your data, and who supports it. Skip any app that fails on approvals or data control.

A new integration is a long-term commitment. Once clients' documents and approvals flow through an app, replacing it is disruptive. Use the same checklist for every candidate, and write the answers down so you can compare options fairly.

### What is the integration checklist?

1. **Define the job.** Write one sentence saying what the app replaces or speeds up. If you cannot, you do not need it yet.
2. **Check the direct connection.** Confirm the app connects to your ledger through the vendor's own integration. Test it in a sandbox or a low-risk client file.
3. **Confirm the approval step.** Find out whether anything posts to the ledger without a person approving it, and whether you can turn that off.
4. **Ask where data lives.** Get the vendor's answer on storage location, retention and deletion. Note any limits that matter for your clients.
5. **Review permissions.** Check whether staff and contractors can be limited to the clients and actions they need.
6. **Price it at your scale.** Work out the monthly cost for your real client count and the cost of adding clients later.
7. **Test the exit.** Export a sample of your data and confirm you can read it without the vendor's software.
8. **Check support.** Send a real question to support before you buy and note how long the answer takes.

### Which red flags rule an app out?

Treat these as automatic disqualifiers for client work. First, the app posts transactions to the ledger with no review step and no way to add one. Second, the vendor cannot say where client data is stored or how long it is kept. Third, there is no practical way to export your data. Fourth, every user shares one login.

### How should you test a new integration?

Pilot with one client, one workflow and a fixed period. Compare the result to your current process on time spent, errors found and how often a person had to correct the output. Keep a short log of problems. At the end of the pilot, decide to expand, adjust or stop.

**A simple scorecard for comparing two candidate apps (illustrative layout)**

| Question | App A | App B |
| --- | --- | --- |
| **Direct ledger connection tested** | Yes / No | Yes / No |
| **Approval before posting** | Required / Optional / None | Required / Optional / None |
| **Data location documented** | Yes / No | Yes / No |
| **Role-based access** | Yes / No | Yes / No |
| **Cost at your client count** | Amount | Amount |
| **Export tested** | Yes / No | Yes / No |

> **Tip:** Ask every vendor the same questions in writing. Written answers become part of your file if a client or regulator later asks how you chose a tool.

## 4. How does Claude connect to QuickBooks Online, Xero and Excel?

> **Short answer:** Claude reaches your accounting tools through connectors, which give it direct access to external platforms. Intuit offers a QuickBooks connector in Claude, Xero offers a connector that is read-only at launch, and Claude for Excel works inside a spreadsheet sidebar. What each can change in your books differs, so test with a non-client file first.

A connector is a managed link between Claude and another app. Anthropic describes connectors as giving Claude direct access to external tools and platforms. Instead of exporting a report and pasting it into a chat, you ask a question and Claude reads the data through the connection, using the permissions of the account you signed in with.

### What does the QuickBooks connector do?

According to Intuit's April 2026 announcement, businesses can use the QuickBooks connector in Claude to analyze profitability and cash flow, compare against similar businesses by industry and region, and generate reports such as profit and loss and cash flow statements. An August 2026 trade report says QuickBooks added sales invoicing, payroll and capital-lending intelligence, and describes the integration as moving beyond read-only access. That report does not list the specific actions available, and neither source states country availability. If you work in a Canadian QuickBooks Online file, confirm in your own account which features appear.

### What does the Xero connector do?

Xero's Canadian page describes a secure connection that answers plain-English questions about profit, cash, invoices and customers using live Xero data, with links back to the report, invoice or contact it used. Xero states that the connector is read-only: Claude cannot create, edit, approve, reconcile or pay in Xero, and that limit applies at launch, so it may change. Accountants and bookkeepers can switch between client organizations. Xero also notes that answers are only as good as the books, and that two invoices that look alike may both be genuine.

### What can Claude do inside Excel?

Anthropic says Claude for Excel can discuss how a spreadsheet works, modify it while preserving structure and formula dependencies, debug cell formulas and populate templates with new data and assumptions. It also tracks and explains its changes and lets you jump to the cells it references. An ICAEW article from January 2026 gives one practitioner's hands-on observations, including cases where the add-in's changes needed checking, which is a fair reminder to review every edit.

**How Claude connects to common accounting tools (based on vendor statements; confirm in your own account)**

| Tool | Connection | What the vendor says it does | Check before relying on it |
| --- | --- | --- | --- |
| **QuickBooks Online** | Intuit connector in Claude | Reports, profitability, cash flow, benchmarks; expanded to sales, payroll and lending | Which actions are available in your region and plan |
| **Xero** | Xero connector in Claude | Read-only answers from live data, with links to sources | That it remains read-only; any write access needs a separate route |
| **Excel** | Claude for Excel add-in | Reads, edits and builds workbooks in a sidebar | Plan availability, since it launched as a research preview |
| **Microsoft 365 files** | Microsoft 365 connection | Search files, emails and Teams conversations; create Excel and PowerPoint files in the Claude apps | Your tenant's admin settings |

### What is the difference between reading and writing?

A read connection lets Claude see your data and answer questions. A write connection lets it change records. Reading is far lower risk. When a connector can write, treat Claude's proposed change like a junior colleague's journal entry: review it before it posts, and keep a record of who approved it.

> **Tip:** Connect a demo or test company file first. Ask the same five questions you would ask about a real client and compare Claude's answers to the ledger line by line.

## 5. What should you use Claude for, and what should you not?

> **Short answer:** Use Claude for first drafts, analysis you will verify, spreadsheet work and explaining numbers to clients. Use it with care for coding transactions and reviewing documents. Do not let it make technical tax or assurance judgments, approve payments or sign off on work without a qualified person reviewing the result.

The useful way to sort tasks is by what happens if the answer is wrong. A weak draft email costs you a minute of editing. A wrong GST/HST treatment that nobody checks costs a client money. Match the level of review to the cost of an error.

**Sorting accounting tasks by how much review they need**

| Fit | Examples | How to use Claude |
| --- | --- | --- |
| **Good fit** | Drafting client emails and requests, summarizing a long contract or engagement letter, explaining a variance in plain language, turning notes into a memo, writing a month-end checklist | Ask for a draft, edit it yourself |
| **Good fit with checks** | Building or repairing spreadsheet formulas, analyzing a report you provide, comparing two periods, drafting working-paper commentary | Verify totals to source and test formulas on known data |
| **Use with care** | Suggesting account coding, flagging unusual transactions, extracting figures from documents | Treat output as suggestions, sample-check, keep a person approving postings |
| **Keep with a qualified person** | Tax positions, assurance conclusions, going-concern assessments, approving payments, anything signed under your name | Use only for research support or a second reading |

### Can Claude do analytical review?

Claude can help with analytical review when you provide both periods' figures. A prompt such as "Compare these two trial balances, list the accounts that moved most, and propose questions to ask the client about each" produces a useful starting list. You then decide which movements matter and investigate them. The assistant is working from the numbers you gave it, so a missing account or a wrong period gives a confident but misleading answer.

### Can Claude help with month-end and close?

It can turn your close process into a checklist, draft reminder messages to clients who owe documents, and help write the notes that explain unusual entries. It cannot confirm that the bank reconciliation agrees to the statement unless you give it both and verify its work.

### Can Claude answer tax questions?

Claude can explain a concept, outline the questions to ask and point you toward the area of legislation to read. Tax and compliance conclusions remain a professional judgment that rests with you. Xero says the same about its own connector: it does not replace your accountant or bookkeeper. Always confirm against the legislation, CRA guidance or your firm's technical resources.

### What about the risk of invented answers?

AI assistants can produce plausible text that is wrong. CPA Ontario's guidance says errors of this kind must be identified and corrected during professional review. Make this routine: ask Claude to cite which row, cell or document each figure came from, then check those references yourself.

> **Tip:** End analytical prompts with "List anything you could not verify from the data I provided." It turns hidden guesses into a visible to-do list.

## 6. How do you write prompts that work for accounting?

> **Short answer:** A good accounting prompt states the role and client context, supplies the exact data, defines the output format, and asks Claude to show its working and flag gaps. Specific prompts that name the period, entity and format outperform short questions, because Claude cannot see context you leave out.

Claude only knows what is in the conversation and the sources you have connected. Most disappointing answers come from missing context, not from the assistant being unable to do the task. A reliable structure removes most of the guesswork.

### What is a reliable prompt structure?

1. **Say who and what.** State the entity type, jurisdiction and period, for example "a Canadian corporation with a December year-end, reviewing November."
2. **Provide the data.** Attach the report or connect the file. Name the period and the basis of preparation.
3. **State the task.** Use one clear verb: reconcile, compare, summarize, draft, list questions.
4. **Define the output.** Ask for a table, a memo of a set length, or a checklist, and say who will read it.
5. **Require working.** Ask Claude to show the calculation, cite its source rows and list assumptions.
6. **Ask for the gaps.** Finish by asking what it could not verify or what it needs from you.

### What do good prompts look like?

The examples below are templates to adapt. Replace the bracketed items with your own details, and never include client identifiers in a tool your policy does not cover.

**Example prompt templates for common accounting tasks**

| Task | Template |
| --- | --- |
| **Variance commentary** | "Here are [period] and [prior period] income statements for [entity type]. List the five largest variances, give one plain-English reason to investigate for each, and mark which need client input." |
| **Document request** | "Draft a short, friendly email asking [client] for the missing items on this list. Keep it under 120 words and give a deadline of [date]." |
| **Formula repair** | "This formula in cell [ref] returns [wrong result]. Explain why and propose a fix. Do not change any other cells." |
| **Close checklist** | "Turn these month-end steps into a checklist with an owner and due day for each. Flag steps that depend on another step." |
| **Coding review** | "Review these 40 transactions against this chart of accounts. Suggest an account for each, mark confidence as high, medium or low, and explain every low-confidence suggestion." |

### How do you improve a weak answer?

Treat the first answer as a draft and respond to it. Say what is wrong in specific terms: "You treated this as a cost of sales, but it is a prepaid expense. Redo the table with that change." Specific feedback improves the next answer far more than rewording the original request.

### Should you ask for a confidence level?

Yes, for coding and extraction tasks. Asking for high, medium or low confidence gives you a sorting rule for your review: check low-confidence items first and sample the rest. The same idea is used in ScanTrix's own review tiers, described in Chapter 9.

> **Tip:** Keep a short library of prompts that worked, with the date and what you changed. A prompt you can reuse is worth more than a clever one-off.

## 7. How do you set Claude up for repeatable work?

> **Short answer:** Set up repeatable work by saving your standing instructions, templates and checklists where Claude can reuse them, such as in a Project or as a Skill. Skills are folders of instructions, scripts and resources that Claude can use for a given task. Write one for each recurring job and review it quarterly.

Typing the same context into every conversation wastes time and invites inconsistency. Claude offers several ways to store it once.

### What are Projects and Skills?

A Project in the Claude apps keeps files and instructions together so every conversation inside it starts with the same background. Anthropic describes Skills as folders that include instructions, scripts and resources that Claude can use to perform a given task, and says they work across the Claude apps, Claude Code and the API. In practice, a Project suits a client or an engagement, while a Skill suits a procedure you repeat across many clients. Features and plan availability change, so confirm what your plan includes.

### What should you write into standing instructions?

- Your jurisdiction, reporting frameworks and year-end conventions.
- Your firm's terminology, such as how you name accounts and describe variances.
- The output format you want for memos and tables.
- Rules for caution, such as "always list assumptions" and "never present a tax conclusion as final."
- Things to avoid, such as client names in drafts that leave the firm.

### Which workflows suit a Skill?

Choose a procedure that is stable, repeated and checkable. Good candidates are a month-end review checklist, a standard client information request, a compilation working-paper layout, or a first-pass review of an expense listing. Write the steps as you would brief a new staff member, include one worked example, and state what a good result looks like.

**Choosing where to store repeatable instructions**

| Need | Good home | Why |
| --- | --- | --- |
| **One client's background and files** | A Project for that client | Keeps context and documents together |
| **A procedure used across clients** | A Skill | Reusable steps with the same standard every time |
| **Firm-wide style and cautions** | Standing instructions | Applies your house rules to every conversation |
| **One-off question** | A normal chat | No setup needed |

### How do you keep instructions from going stale?

Give each instruction set an owner, a version date and a review reminder. Re-test it when tax rules, your software or the Claude models change. If a result starts to drift, update the instructions rather than correcting each answer by hand.

### How do you build in review?

Put the review step inside the procedure. A strong Skill ends with "list what you verified, what you could not verify and what a person must check before this is sent." That line makes the review visible and gives staff a consistent trail to follow.

> **Tip:** Start with one Skill for the task you dread most. If it saves time on that one, the next three are easier to justify.

## 8. How do you use Claude safely with client data?

> **Short answer:** Use Claude safely by choosing a plan whose data terms fit client work, writing a short AI policy, limiting what you upload, checking permissions on every connector and reviewing all output before it leaves the firm. CPA Ontario says the same confidentiality and professional obligations apply to AI as to any other software.

Confidentiality is the first question clients and regulators ask. The answer depends on the plan you use and the choices you make.

### Which plan fits client data?

Anthropic's Commercial Terms, which cover Team and Enterprise offerings and the API, state that Anthropic may not train models on Customer Content from those Services. Anthropic's privacy centre also says that under its commercial products the customer is the controller of data submitted by its users and Anthropic acts as processor. Consumer plans work differently: Anthropic's August 2025 update says that it trains new models on Free, Pro and Max account data when that setting is on, and that users can change the choice in Privacy Settings. Read the current terms yourself before you decide, because they can change, and confirm how your engagement letters treat third-party tools.

### What do the professional rules say?

CPA Ontario's guidance on responsible use of AI ties the issue to the Code of Professional Conduct. It points to Rule 202, which requires integrity, due care and professional skepticism, and Rule 208, which protects confidential information. Its earlier article on accountabilities asks CPAs to consider how they govern generative AI and how third-party AI products meet their obligations. The Canadian Public Accountability Board's 2024 paper on AI in the audit likewise tells auditors to keep a heightened level of professional skepticism and not rely solely on AI-generated conclusions. This guide is general information and not professional-conduct advice; check your own regulator's current guidance.

### What belongs in a one-page AI policy?

1. **Approved tools.** List which AI tools staff may use and on which plan or account.
2. **Data rules.** Say what may and may not be uploaded, and when to remove client names and identifiers.
3. **Review standard.** Require a named person to review any AI-assisted work before it is used or sent.
4. **Connector permissions.** Record which apps are connected, who connected them and what each can read or change.
5. **Records.** Keep notes on significant AI-assisted work in the engagement file.
6. **Client communication.** Update engagement letters or notices if your approach to third-party tools changes.
7. **Review date.** Set a date to revisit the policy, at least yearly.

### How should you handle connector access?

Give each connector the least access that does the job. Prefer read-only connections for analysis. Disconnect tools you no longer use. Xero notes that the access of its connector follows your existing Xero permissions and that you can disconnect at any time, in Claude or Xero. Keep a list of who connected what so you can revoke it when staff leave.

### What about shadow AI?

Staff use AI tools whether or not the firm has a policy. CPA Ontario has written about the risk of unsanctioned use. A clear policy and a tool you approve are better than a ban people quietly ignore.

> **Tip:** Run a one-hour session where every staff member shows how they actually use AI today. You will learn what the policy needs to cover.

## 9. Where does ScanTrix fit in a connected stack?

> **Short answer:** ScanTrix is the capture layer. It reads invoices that arrive by photo, upload, email forward or Google Drive and prepares them as bills for QuickBooks Online or Xero, with duplicate checks and a required approval step. It handles invoice scanning only at present, so it sits alongside your ledger, spreadsheet and AI assistant.

Earlier chapters described layers. This one explains where ScanTrix fits and what it does today, so you can judge it against the checklist in Chapter 3.

### What does ScanTrix do today?

- Scans invoices with AI and proposes the vendor, amounts and account coding.
- Accepts documents by photo, upload, email forwarding and Google Drive link or save.
- Posts bills to QuickBooks Online and Xero.
- Checks for duplicates before posting.
- Creates vendors and general-ledger accounts as part of the flow.
- Runs on iOS and on the web, with Android in beta.

### How does the review process work?

ScanTrix shows a confidence level for each invoice. At 90% and above an invoice is eligible to post automatically. Between 70% and 89% it goes to review. Below 70% it needs manual entry. Approval before posting is required by default for the Owner, Admin and Accountant roles, and can be bypassed only through explicit trusted settings. The upload-only Contributor role always requires approval, with no bypass.

**ScanTrix confidence tiers and what happens at each level**

| Confidence | Meaning | What happens |
| --- | --- | --- |
| **90% and above** | High confidence | Eligible to post automatically |
| **70–89%** | Needs a look | Held for review |
| **Below 70%** | Low confidence | Manual entry |

### How does it connect with Claude-based workflows?

ScanTrix and Claude do different jobs. ScanTrix captures and prepares invoices and posts them to the ledger, where you keep the approval step. Once the bills are in QuickBooks Online or Xero, a connected assistant such as Claude can help you analyze the resulting reports, subject to what each connector allows. Cleaner, more current ledger data gives any assistant better material to read.

### What is not covered yet?

ScanTrix's initial launch covers invoice scanning only. Other accounting tasks, such as bank reconciliation, supplier statements and payroll, are not part of the current product, so keep using your existing tools for those.

### Try the capture layer on one client

Run a small pilot with one client and one month of invoices. Compare the time spent and the corrections needed against your current process.

[Start your pilot](/register) · [Ask a question](mailto:${SUPPORT_EMAIL}?subject=ScanTrix%20capture%20layer%20question)

## 10. What is a 90-day plan for getting ready for 2027?

> **Short answer:** Spend the first 30 days documenting your current stack and writing an AI policy, the next 30 piloting one workflow with one client, and the last 30 reviewing results and expanding carefully. A staged rollout limits risk, produces evidence for your decisions and keeps staff on board.

Treat this as a template. Adjust the timing to your busy season and the size of your team.

### Days 1 to 30: map and decide

1. **Draw the stack.** List every app, who uses it and where people re-key data. Mark the three most time-consuming handoffs.
2. **Pick one workflow.** Choose a task that is frequent, rule-based and easy to review, such as invoice capture or a monthly client report.
3. **Write the AI policy.** Use the one-page outline from Chapter 8 and share it with staff.
4. **Choose the plan and accounts.** Decide which Claude plan fits your data needs and who administers it.

### Days 31 to 60: pilot

1. **Select a pilot client.** Pick a client with a manageable volume and a cooperative contact. Tell them how you are using the tools.
2. **Connect with least access.** Start with read-only connections and a test file where possible.
3. **Track the numbers.** Record time per task, errors found in review and the number of corrections.
4. **Write your first Skill.** Capture the pilot procedure so a colleague can repeat it.

### Days 61 to 90: review and expand

1. **Compare results.** Set pilot numbers against your baseline. Decide whether the time saved justifies the cost and the added review.
2. **Fix the gaps.** Update the policy, instructions and Skill with what you learned.
3. **Add two or three clients.** Expand slowly and keep the same tracking.
4. **Set a review date.** Put a quarterly review in the calendar to revisit tools, plans and policy.

**What to measure during the pilot (illustrative, not a benchmark)**

| Measure | How to capture it | What it tells you |
| --- | --- | --- |
| **Time per task** | Note start and finish for the pilot and a comparable past period | Whether it actually saves time |
| **Corrections** | Count items a person changed during review | Where the tool needs closer supervision |
| **Escapes** | Count errors found after approval | Whether review is catching enough |
| **Staff feedback** | Short weekly check-in | Whether people will keep using it |

> Small pilots produce evidence. Big switches produce stories.

## Frequently asked questions

### Will AI replace accountants by 2027?

The sources reviewed for this guide describe AI taking over repetitive steps while professionals remain accountable for the work. CPA Ontario says the same obligations apply to AI as to any other software, and that members must apply professional skepticism. Plan for a changing role, not a disappearing one.

### Can Claude connect to QuickBooks Online?

Yes. Intuit announced in April 2026 that its QuickBooks app is available in Claude, covering analysis of profitability, cash flow and report generation. A later trade report says it expanded into sales, payroll and lending, but does not list country availability, so confirm in your own account which features you can use.

### Can Claude change my data in Xero?

Not through Xero's official connector as described at launch. Xero says the connector is read-only and that Claude cannot create, edit, approve, reconcile or pay in Xero. Xero notes the limit applies at launch, so check Xero's current page before relying on it.

### What is Claude for Excel?

Claude for Excel is an add-in that puts Claude in a sidebar in Microsoft Excel, where it can read, analyze, modify and create workbooks. Anthropic released it in October 2025 as a research preview for certain plans, so confirm current availability and review every change it makes.

### What is a connector?

A connector is a managed link that gives Claude direct access to an external tool or platform, such as an accounting system. Claude uses the permissions of the account you connect with. Prefer read-only access for analysis and review which actions each connector allows.

### Is it safe to put client data into Claude?

It depends on the plan, the data and your obligations. Anthropic's Commercial Terms say it may not train models on Customer Content from services under those terms, while consumer plans have a training setting you control. Read the current terms, write an AI policy and follow your regulator's confidentiality rules.

### What do the CPA rules say about using AI?

CPA Ontario ties AI use to the Code of Professional Conduct, including Rule 202 on due care and professional skepticism and Rule 208 on confidentiality. Errors and hallucinations must be found and corrected in professional review. Check your own regulator's latest guidance.

### Is e-invoicing mandatory in Canada?

As of the sources reviewed for this guide, there is no mandatory business-to-business e-invoicing requirement in Canada. Xero's Canadian guide says the Canada Revenue Agency is studying it for GST/HST compliance and that Canada joined the Peppol network in 2023. Watch CRA announcements for any change.

### What should I automate first?

Automate the task you repeat most that is also easy to review, which for many small practices is invoice and bill entry. It improves reporting downstream, and a person can check each result. Pilot it with one client before expanding.

### What is a Claude Skill?

Anthropic describes Skills as folders that include instructions, scripts and resources that Claude can use to perform a given task, and says they work across Claude apps, Claude Code and the API. Use one for a procedure you repeat, such as a month-end review checklist.

### How do I stop Claude giving wrong numbers?

Give it the data instead of asking it to recall figures, ask it to cite the row or cell for each number and to list what it could not verify, then check those references yourself. Treat its output as a draft until a person has reviewed it.

### What does ScanTrix do and how does it relate to Claude?

ScanTrix scans invoices and posts them as bills to QuickBooks Online and Xero, with duplicate checks and an approval step. It is the capture layer in your stack. Once bills are in your ledger, an assistant such as Claude can help analyze the resulting reports, subject to its connector's permissions.

## Glossary

**Accounts payable (AP)**
Money a business owes to its suppliers, usually tracked from the moment a supplier invoice is received until it is paid.

**AI assistant**
Software that uses a language model to answer questions, draft text and analyze data from the information you give it or connect.

**Approval step**
A point in a workflow where a person reviews and accepts an item before it posts to the ledger.

**Confidence level**
A score showing how sure a tool is about a suggested result, used to decide how much human review an item needs.

**Connector**
A managed link that gives an AI assistant direct access to an external tool or platform.

**Hallucination**
A confident-sounding answer from an AI model that is wrong or unsupported by the data.

**MCP (Model Context Protocol)**
An open standard for connecting AI assistants to external tools and data sources, often used to build connectors.

**Peppol**
An international network for exchanging structured electronic invoices between businesses and governments.

**Professional skepticism**
A questioning mind and critical assessment of evidence, required of CPAs when they rely on any source, including AI output.

**Project**
A workspace in the Claude apps that keeps files and standing instructions together for related conversations.

**Read-only connection**
A connection that lets an assistant view data but not create, edit or delete anything.

**Skill**
A folder of instructions, scripts and resources that Claude can use to carry out a repeatable task.

**Structured e-invoice**
An invoice issued in a machine-readable format so software can process it without manual re-entry.

## Sources

Every source below was retrieved and read in November 2026. This guide uses no statistics. Vendor features change quickly, so confirm current details on each vendor's site.

- Anthropic, "Advancing Claude for Financial Services," October 2025. [anthropic.com](https://www.anthropic.com/news/advancing-claude-for-financial-services)
- Craig Stirk, ICAEW, "Using the Claude add-in for Excel – an initial exploration," 9 January 2026. [icaew.com](https://www.icaew.com/technical/technology/excel-community/excel-community-articles/2026/using-the-claude-add-in-for-excel-an-initial-exploration)
- Intuit, "Intuit's financial intelligence apps are now available in Claude," 23 April 2026. [intuit.com](https://www.intuit.com/blog/news-social/intuit-apps-now-available-in-claude/)
- Accountants Daily, "QuickBooks deepens partnerships with AI powerhouses," 6 August 2026. [accountantsdaily.com.au](https://www.accountantsdaily.com.au/technology/22751-quickbooks-deepens-partnerships-with-ai-powerhouses)
- Xero Canada, "Xero connector in Claude." [xero.com](https://www.xero.com/ca/ai-in-accounting/claude/)
- Xero Canada, "What is e-invoicing" guide for accountants and bookkeepers. [xero.com](https://www.xero.com/ca/accountant-bookkeeper-guides/what-is-e-invoicing/)
- CPA Ontario, "The responsible use of AI." [cpaontario.ca](https://www.cpaontario.ca/members/regulations-guidance/regulatory-publications/the-responsible-use-of-ai)
- CPA Ontario, "Accountabilities for CPAs in the Age of Artificial Intelligence," August 2024. [cpaontario.ca](https://www.cpaontario.ca/members/regulations-guidance/regulatory-publications/accountabilities-for-cpas-in-the-age-of-artificial-intelligence)
- CPA Ontario, "The hidden risk of shadow AI." [cpaontario.ca](https://www.cpaontario.ca/insights/blog/hidden-risk-shadow-ai)
- CPAB, "The use of artificial intelligence in the audit: balancing innovation and risk," September 2024. [cpab-ccrc.ca](https://cpab-ccrc.ca/docs/default-source/thought-leadership-publications/2024-use-of-artificial-intelligence-in-the-audit-en.pdf)
- Anthropic, Commercial Terms of Service. [anthropic.com](https://www.anthropic.com/legal/commercial-terms)
- Anthropic Privacy Center, "Does Anthropic act as a data processor or controller?" [privacy.claude.com](https://privacy.claude.com/en/articles/9267385)
- Anthropic, "Updates to Consumer Terms and Privacy Policy," 28 August 2025. [anthropic.com](https://www.anthropic.com/news/updates-to-our-consumer-terms)

## Questions about your own setup?

Write to [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}) and describe your accounting platform and how many clients you support.

*© 2026 ScanTrix Technologies Inc. All rights reserved. This guide is general information for accounting professionals and is not tax, legal or investment advice. QuickBooks is a trademark of Intuit Inc. Xero is a trademark of Xero Limited. ScanTrix is not affiliated with or endorsed by Intuit or Xero. Last updated November 23, 2026.*
`;
