// Paperwork requests for bank lines with no receipt (paperwork.ts).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { __closeBankDbForTests, type Db } from "../lib/bankFeeds/db";
import { can } from "../lib/bankFeeds/door";
import { attachToLine, canReadAttachment, createRequest, hasPaperwork, listRequests, paperworkEmail, readAttachment, readTeam } from "../lib/bankFeeds/paperwork";
import { decide, importCsv, listTransactions } from "../lib/bankFeeds/transactions";

import { memberLabel } from "../components/v2/bankTransactions/RequestPaperworkModal";
import { BANK_TEST_DATABASE_URL as URL, clearBankTestData, openTestDb, resetBankTestDatabase } from "./helpers/bankTestDb";

describe("who can be asked", () => {
  const user = (id: string, firstName: string, email: string) => ({ _id: id, firstName, lastName: "", email });

  it("everyone on the team, pending invites marked; never the forwarding account (Saurabh, 20 Nov)", () => {
    const team = readTeam({
      owner: { userId: user("u-own", "Saurabh", "S@x.com") },
      members: [
        { userId: user("u-adm", "Ana", "ana@x.com"), role: "admin", inviteStatus: "accepted" },
        { userId: user("u-acc", "Raj", "raj@x.com"), role: "accountant", inviteStatus: "accepted" },
        { userId: user("u-c1", "Cara", "cara@x.com"), role: "contributor", inviteStatus: "accepted", pageAccess: ["invoices", "bank-transactions"] },
        { userId: user("u-c2", "Dev", "dev@x.com"), role: "contributor", inviteStatus: "accepted", pageAccess: ["invoices"] },
        { userId: user("u-pend", "Pat", "pat@x.com"), role: "admin", inviteStatus: "pending" },
        { userId: user("u-fwd", "Forwarding", "fwd@x.com"), role: "contributor", inviteStatus: "accepted", isForwardingService: true, pageAccess: ["bank-transactions"] },
        { role: "admin", inviteStatus: "pending", invitedEmail: "new@x.com" },
      ],
    });
    assert.deepEqual(team.map((m) => m.userId), ["u-own", "u-adm", "u-acc", "u-c1", "u-c2", "u-pend", "invite:new@x.com"]);
    assert.equal(team[0].email, "s@x.com");
    const by = new Map(team.map((m) => [m.userId, m]));
    assert.equal(by.get("u-c2")?.canOpenBank, false, "a contributor without Bank Transactions is listed, and marked");
    assert.equal(by.get("u-c1")?.canOpenBank, true);
    assert.deepEqual([by.get("u-pend")?.pending, by.get("u-pend")?.askable], [true, true], "invited and has an account: can be asked");
    assert.deepEqual([by.get("invite:new@x.com")?.pending, by.get("invite:new@x.com")?.askable], [true, false], "invited by email only: shown, can't be picked yet");
    assert.equal(memberLabel(by.get("u-pend")!), "Pat (pat@x.com) · Admin · Invite pending");
    assert.equal(memberLabel(by.get("u-c2")!), "Dev (dev@x.com) · Contributor · can't open Bank Transactions yet");
  });

  it("a contributor may open only their own requests, never the bank lines", () => {
    assert.equal(can("contributor", "paperwork"), true);
    assert.equal(can("contributor", "view"), false);
    assert.equal(can("unknown", "paperwork"), false);
  });
});

describe("the email to the person asked", () => {
  it("lists the lines, the note and the link", () => {
    const mail = paperworkEmail({
      request: { _id: "r1", qbConnectionId: "qb", requestedBy: { userId: "u1", name: "Pranamya", email: null }, assignee: { userId: "u2", name: "Raj", email: "raj@x.com" }, note: "Toronto <trip>", lineIds: ["a"], status: "open", createdAt: new Date(), doneAt: null, emailed: null },
      companyName: "Savetrix",
      link: "https://app.test/bank-transactions?tab=requests",
      lines: [{ date: "2026-11-10", description: "TIM HORTONS 0412", amountCents: -625, currency: "CAD" }],
    });
    assert.match(mail.subject, /1 bank line \(Savetrix\)/);
    assert.match(mail.text, /2026-11-10 {2}TIM HORTONS 0412 {2}6\.25 CAD/);
    assert.match(mail.text, /https:\/\/app\.test\/bank-transactions\?tab=requests/);
    assert.match(mail.html, /Toronto &lt;trip&gt;/, "the note is escaped");
  });
});

describe("requests and receipts", { skip: URL ? false : "BANK_TEST_MONGODB_URI not set" }, () => {
  let db: Db;
  before(async () => {
    await resetBankTestDatabase(URL as string);
    await __closeBankDbForTests();
    db = await openTestDb(URL as string);
  });
  after(async () => {
    await __closeBankDbForTests();
  });
  beforeEach(async () => {
    await clearBankTestData(db);
  });

  const QB = "qb-paper";
  const asker = { userId: "u1", name: "Pranamya", email: null };
  const raj = { userId: "u2", name: "Raj", email: "raj@x.com" };
  const pdf = (name = "receipt.pdf") => ({ name, type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 receipt") });
  const lines = async () => {
    await importCsv(db, {
      qbConnectionId: QB,
      userId: "u1",
      accountLabel: "RBC",
      rows: [
        { date: "2026-11-10", description: "TIM HORTONS 0412", amount: -6.25 },
        { date: "2026-11-11", description: "ESSO 5521", amount: -50 },
        { date: "2026-11-12", description: "PAYMENT TO BILL", amount: -70 },
      ],
    });
    return listTransactions(db, QB);
  };

  it("asks for lines with no receipt, and refuses a line that already has a bill", async () => {
    const [a, b, c] = await lines();
    assert.ok((await decide(db, { qbConnectionId: QB, id: c.id, userId: "u1", patch: { status: "matched", matchedInvoiceId: "inv-1" } })).ok);
    const refused = await createRequest(db, { qbConnectionId: QB, requestedBy: asker, assignee: raj, lineIds: [a.id, c.id], note: null });
    assert.equal(refused.ok, false);
    const made = await createRequest(db, { qbConnectionId: QB, requestedBy: asker, assignee: raj, lineIds: [a.id, b.id], note: " fuel " });
    assert.ok(made.ok);
    if (!made.ok) return;
    assert.equal(made.request.status, "open");
    assert.equal(made.request.note, "fuel");
    assert.deepEqual((await listRequests(db, QB, { assigneeId: "u2" })).map((r) => r._id), [made.request._id]);
    assert.deepEqual(await listRequests(db, QB, { assigneeId: "u9" }), [], "someone else sees none of it");
  });

  it("the person asked uploads a receipt per line; it attaches to the line, and the request is done when all have one", async () => {
    const [a, b] = await lines();
    const made = await createRequest(db, { qbConnectionId: QB, requestedBy: asker, assignee: raj, lineIds: [a.id, b.id], note: null });
    assert.ok(made.ok);
    if (!made.ok) return;
    const id = made.request._id;

    const stranger = await attachToLine(db, { qbConnectionId: QB, requestId: id, lineId: a.id, uploader: { userId: "u9", name: "", email: null }, canCode: false, file: pdf() });
    assert.equal(stranger.ok ? 0 : stranger.status, 403, "only the person asked");
    const wrongType = await attachToLine(db, { qbConnectionId: QB, requestId: id, lineId: a.id, uploader: raj, canCode: false, file: { name: "x.svg", type: "image/svg+xml", bytes: new Uint8Array([1]) } });
    assert.equal(wrongType.ok ? 0 : wrongType.status, 400, "PDFs and photos only");

    const first = await attachToLine(db, { qbConnectionId: QB, requestId: id, lineId: a.id, uploader: raj, canCode: false, file: pdf("tims.pdf") });
    assert.ok(first.ok);
    if (!first.ok) return;
    assert.equal(first.request.status, "open", "one line still waits");
    const line = (await listTransactions(db, QB)).find((l) => l.id === a.id);
    assert.equal(line?.attachments?.[0].name, "tims.pdf", "attached to the bank line");
    assert.ok(hasPaperwork((await db.txns.findOne({ _id: a.id }))!));

    const second = await attachToLine(db, { qbConnectionId: QB, requestId: id, lineId: b.id, uploader: raj, canCode: false, file: pdf("esso.pdf") });
    assert.ok(second.ok && second.request.status === "done", "every line has a receipt: done");

    const found = await readAttachment(db, { qbConnectionId: QB, lineId: a.id, fileId: first.attachment.id });
    assert.ok(found);
    const chunks: Buffer[] = [];
    for await (const chunk of found!.stream as AsyncIterable<Buffer>) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), "%PDF-1.4 receipt");
    assert.equal(await readAttachment(db, { qbConnectionId: "qb-other", lineId: a.id, fileId: first.attachment.id }), null, "never from another company");
  });

  it("the file opens for people who see bank lines and for the person asked, nobody else", async () => {
    const [a] = await lines();
    const made = await createRequest(db, { qbConnectionId: QB, requestedBy: asker, assignee: raj, lineIds: [a.id], note: null });
    assert.ok(made.ok);
    assert.equal(await canReadAttachment(db, { qbConnectionId: QB, lineId: a.id, userId: "u2", canView: false }), true, "the person asked");
    assert.equal(await canReadAttachment(db, { qbConnectionId: QB, lineId: a.id, userId: "u9", canView: false }), false, "a contributor not asked");
    assert.equal(await canReadAttachment(db, { qbConnectionId: QB, lineId: a.id, userId: "u9", canView: true }), true, "an accountant");
  });
});
