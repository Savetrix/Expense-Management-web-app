"use client";

import { ChevronRight, ExternalLink, Receipt, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { CompactListRow, Modal, ModalDefinitionRow, RoleInfoBanner, SearchInput, Tabs } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  approveExpenseClaim,
  deleteExpenseClaim,
  fetchExpenseClaims,
  markExpenseClaimPaid,
  payExpenseClaim,
  rejectExpenseClaim,
  removeClaimReceipt,
  updateReceiptNote,
  type ClaimReceiptDto,
  type ClaimStatus,
  type ExpenseClaimDto,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { PayEmployeeModal } from "./PayEmployeeModal";
import { CARD_CLASS, CLAIM_STATUS_META, TOOLBAR_CLASS, errorMessage, isApprover, money, monthLabel, shortDate, type CompanyRole } from "./shared";

interface ClaimsTabProps {
  claims: ExpenseClaimDto[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  role: CompanyRole;
  selfId: string;
  allowSelfApproval: boolean;
  onNewClaim: () => void;
}

const STATUS_ORDER: ClaimStatus[] = ["awaiting_review", "awaiting_reimbursement", "paid", "rejected"];
// Approvers also get the claims in review that were sent to them.
type View = ClaimStatus | "assigned";

export const claimTitle = (claim: Pick<ExpenseClaimDto, "claimant" | "month">) => `${claim.claimant.name} — ${monthLabel(claim.month)}`;

type BusyAction = "approve" | "approvePay" | "reject" | "markPaid" | "removeReceipt" | "deleteClaim" | "note";

export function ClaimsTab({ claims, loading, error, onRetry, role, selfId, allowSelfApproval, onNewClaim }: ClaimsTabProps) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const approver = isApprover(role);
  const [status, setStatus] = useState<View>(approver ? "assigned" : "awaiting_review");
  const [search, setSearch] = useState("");
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [payClaimId, setPayClaimId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ receiptId: string; text: string } | null>(null);
  const [rejectDraft, setRejectDraft] = useState<{ claimId: string; reason: string } | null>(null);

  const isAssignedToMe = (claim: ExpenseClaimDto) => claim.status === "awaiting_review" && claim.approver?.userId === selfId;

  const counts = useMemo(() => {
    const c: Record<View, number> = { assigned: 0, awaiting_review: 0, awaiting_reimbursement: 0, paid: 0, rejected: 0 };
    claims.forEach((cl) => {
      c[cl.status] += 1;
      if (cl.status === "awaiting_review" && cl.approver?.userId === selfId) c.assigned += 1;
    });
    return c;
  }, [claims, selfId]);

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return claims
      .filter((c) => (status === "assigned" ? c.status === "awaiting_review" && c.approver?.userId === selfId : c.status === status))
      .filter((c) => !lower || claimTitle(c).toLowerCase().includes(lower))
      .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.claimant.name.localeCompare(b.claimant.name)));
  }, [claims, status, search, selfId]);

  const openClaim = claims.find((c) => c.id === openClaimId) ?? null;
  const payingClaim = claims.find((c) => c.id === payClaimId);
  const payTarget = payingClaim
    ? { id: payingClaim.id, noun: "claim" as const, payee: payingClaim.claimant.name, amount: payingClaim.total, currency: payingClaim.currency }
    : null;

  // Nobody approves a claim they created or that's theirs, unless the company
  // allows it (Settings). The backend enforces the same rule.
  const isOwnClaim = (claim: ExpenseClaimDto) => claim.createdBy === selfId || claim.claimant.userId === selfId;
  const selfApprovalBlocked = (claim: ExpenseClaimDto) => isOwnClaim(claim) && !allowSelfApproval;
  // The approver it was sent to acts on it, or an owner/admin as backup.
  const canAct = (claim: ExpenseClaimDto) => !claim.approver || claim.approver.userId === selfId || role === "owner" || role === "admin";
  // Approving posts the bill, which needs a GL account on every receipt — the
  // backend refuses approval until they're coded.
  const uncoded = (claim: ExpenseClaimDto) => claim.receipts.filter((r) => !r.glAccountId);

  const run = async <T,>(key: BusyAction, action: () => Promise<{ ok: boolean; payload: T }>, success: string, fallback: string) => {
    setBusyAction(key);
    const { ok, payload } = await action();
    setBusyAction(null);
    if (ok) showToast(success, "success");
    else showToast(errorMessage(payload, fallback), "error");
    return ok;
  };

  const handleApprove = async (claim: ExpenseClaimDto) => {
    const ok = await confirmDialog({
      title: `Approve and post to ${provider.name}?`,
      message: `This creates one bill in ${provider.name} payable to ${claim.claimant.name} for ${money(claim.total, claim.currency)}, with every receipt attached (they're added as a vendor there if they aren't one yet). The receipts then show in your invoices, tagged as an expense claim.`,
      confirmLabel: "Approve & post",
    });
    if (!ok) return;
    await run(
      "approve",
      async () => {
        const r = await dispatch(approveExpenseClaim({ id: claim.id, expectedTotal: claim.total }));
        if (approveExpenseClaim.rejected.match(r) && r.payload?.code === "CLAIM_CHANGED") dispatch(fetchExpenseClaims());
        return { ok: approveExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} approved and posted to ${provider.name} — now awaiting reimbursement.`,
      "Couldn't approve the claim.",
    );
  };

  const handleApproveAndPay = async (claim: ExpenseClaimDto) => {
    const ok = await confirmDialog({
      title: "Approve, post and mark as paid?",
      message: `This posts ${claimTitle(claim)} to ${provider.name} as one bill payable to ${claim.claimant.name}, and records that they've been paid ${money(claim.total, claim.currency)}. Scantrix doesn't send the money — pay them as you usually do.`,
      confirmLabel: "Approve & mark paid",
    });
    if (!ok) return;
    await run(
      "approvePay",
      async () => {
        const r = await dispatch(approveExpenseClaim({ id: claim.id, pay: true, expectedTotal: claim.total }));
        if (approveExpenseClaim.rejected.match(r) && r.payload?.code === "CLAIM_CHANGED") dispatch(fetchExpenseClaims());
        return { ok: approveExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} approved, posted to ${provider.name} and marked as paid.`,
      "Couldn't approve the claim.",
    );
  };

  const handleReject = async (claim: ExpenseClaimDto) => {
    if (!rejectDraft) return;
    const done = await run(
      "reject",
      async () => {
        const r = await dispatch(rejectExpenseClaim({ id: claim.id, reason: rejectDraft.reason.trim() }));
        return { ok: rejectExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} rejected. Nothing was sent to ${provider.name}.`,
      "Couldn't reject the claim.",
    );
    if (done) setRejectDraft(null);
  };

  const handleDeleteClaim = async (claim: ExpenseClaimDto) => {
    const ok = await confirmDialog({
      title: "Delete this claim?",
      message: `${claimTitle(claim)} is deleted and its receipts go back to your receipts, ready for a new claim.`,
      confirmLabel: "Delete claim",
      tone: "destructive",
    });
    if (!ok) return;
    const done = await run(
      "deleteClaim",
      async () => {
        const r = await dispatch(deleteExpenseClaim(claim.id));
        return { ok: deleteExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      "Claim deleted.",
      "Couldn't delete the claim.",
    );
    if (done) setOpenClaimId(null);
  };

  const handleMarkPaid = async (claim: ExpenseClaimDto) => {
    const ok = await confirmDialog({
      title: "Mark as paid?",
      message: `Record that ${claim.claimant.name} has been paid back ${money(claim.total, claim.currency)}. Scantrix doesn't send the money.`,
      confirmLabel: "Mark as paid",
    });
    if (!ok) return;
    await run(
      "markPaid",
      async () => {
        const r = await dispatch(markExpenseClaimPaid(claim.id));
        return { ok: markExpenseClaimPaid.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} marked as paid.`,
      "Couldn't mark the claim as paid.",
    );
  };

  const handleSaveNote = async (claim: ExpenseClaimDto) => {
    if (!noteDraft) return;
    const done = await run(
      "note",
      async () => {
        const r = await dispatch(updateReceiptNote({ claimId: claim.id, receiptId: noteDraft.receiptId, note: noteDraft.text }));
        return { ok: updateReceiptNote.fulfilled.match(r), payload: r.payload };
      },
      "Note saved.",
      "Couldn't save the note.",
    );
    if (done) setNoteDraft(null);
  };

  const handleRemoveReceipt = async (claim: ExpenseClaimDto, receipt: ClaimReceiptDto) => {
    const isLast = claim.receipts.length === 1;
    const ok = await confirmDialog({
      title: "Remove receipt?",
      message: isLast
        ? `${receipt.vendor} is the only receipt on this claim, so removing it also deletes the claim. The receipt goes back to your receipts, ready for a new claim.`
        : `${receipt.vendor} (${money(receipt.amount, receipt.currency)}) will be taken off this claim and go back to your receipts, ready for a new claim.`,
      confirmLabel: "Remove receipt",
      tone: "destructive",
    });
    if (!ok) return;
    const done = await run(
      "removeReceipt",
      async () => {
        const r = await dispatch(removeClaimReceipt({ claimId: claim.id, receiptId: receipt.id }));
        return { ok: removeClaimReceipt.fulfilled.match(r), payload: r.payload };
      },
      isLast ? "Receipt removed and the empty claim deleted." : "Receipt removed from the claim.",
      "Couldn't remove the receipt.",
    );
    if (done && isLast) setOpenClaimId(null);
  };

  const emptyCopy: Record<View, { title: string; description: string }> = {
    assigned: {
      title: "Nothing waiting on you",
      description: "Claims your team sends you for approval show up here.",
    },
    awaiting_review: {
      title: "No claims to review",
      description: "Upload an employee's out-of-pocket receipts as a claim — it waits here, and nothing reaches your accounting software until it's approved.",
    },
    awaiting_reimbursement: {
      title: "Nothing awaiting reimbursement",
      description: "Approved claims wait here until the employee has been paid back.",
    },
    paid: { title: "No paid claims yet", description: "Claims you've reimbursed are kept here for reference." },
    rejected: { title: "No rejected claims", description: "Rejected claims stay here with the reason. Their receipts never reach your accounting software." },
  };

  // Whoever made the claim, or an approver who may act on it (the backend's canChangeClaim).
  const mayChange = (claim: ExpenseClaimDto) => claim.createdBy === selfId || (approver && canAct(claim));
  const canEditReceipts = (claim: ExpenseClaimDto) => claim.status === "awaiting_review" && mayChange(claim);
  const canDeleteClaim = (claim: ExpenseClaimDto) => (claim.status === "awaiting_review" || claim.status === "rejected") && mayChange(claim);

  return (
    <>
      <div className="mt-[var(--space-md)]">
        <RoleInfoBanner>
          {approver
            ? `Expense claims never post on their own — approving a claim posts it to ${provider.name} as one bill payable to the employee; rejecting keeps it out.`
            : "You see the claims you created or that are yours. Someone with approval rights approves or rejects them, and reimburses you."}
        </RoleInfoBanner>
      </div>

      <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
        <div className={TOOLBAR_CLASS}>
          <div className="max-w-full overflow-x-auto">
            <Tabs
              items={[
                ...(approver ? [{ value: "assigned", label: "Assigned to me", count: counts.assigned }] : []),
                ...STATUS_ORDER.map((s) => ({ value: s, label: CLAIM_STATUS_META[s].label, count: counts[s] })),
              ]}
              value={status}
              onChange={(v) => setStatus(v as View)}
            />
          </div>
          {claims.length > 0 && (
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by claimant or month…"
              widthClassName="w-full lg:w-80"
            />
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-[var(--space-xl)]">
            <Spinner />
          </div>
        ) : error && claims.length === 0 ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : visible.length === 0 ? (
          search.trim() && counts[status] > 0 ? (
            <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No claims match &quot;{search}&quot;.</div>
          ) : (
            <EmptyState
              icon={<Receipt size={28} strokeWidth={1.75} />}
              title={emptyCopy[status].title}
              description={emptyCopy[status].description}
              actionLabel={status === "awaiting_review" && !approver ? "New expense claim" : undefined}
              onAction={status === "awaiting_review" && !approver ? onNewClaim : undefined}
            />
          )
        ) : (
          <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
            {visible.map((claim) => (
              <CompactListRow
                key={claim.id}
                title={claimTitle(claim)}
                meta={`${claim.receipts.length} receipt${claim.receipts.length === 1 ? "" : "s"}${
                  claim.status === "paid"
                    ? ` · Paid ${shortDate(claim.paidAt)}`
                    : claim.status === "rejected"
                      ? ` · Rejected ${shortDate(claim.rejectedAt)}`
                      : ` · Created ${shortDate(claim.createdAt)}`
                }${claim.status === "awaiting_review" && claim.approver ? ` · Sent to ${isAssignedToMe(claim) ? "you" : claim.approver.name}` : ""}${
                  claim.publishedAt ? ` · In ${provider.name}` : ""
                }`}
                onClick={() => setOpenClaimId(claim.id)}
                trailing={
                  <span className="flex shrink-0 items-center gap-[var(--space-sm)]">
                    <span className="text-body-sm font-bold text-content-primary">{money(claim.total, claim.currency)}</span>
                    <ChevronRight size={18} strokeWidth={2} className="text-content-muted" />
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!openClaim}
        onClose={() => {
          if (busyAction) return;
          setOpenClaimId(null);
          setNoteDraft(null);
          setRejectDraft(null);
        }}
        title={openClaim ? claimTitle(openClaim) : ""}
        widthClassName="max-w-2xl"
        footer={
          openClaim ? (
            <ClaimFooter
              claim={openClaim}
              providerName={provider.name}
              approver={approver}
              selfApprovalBlocked={selfApprovalBlocked(openClaim)}
              canAct={canAct(openClaim)}
              uncodedCount={uncoded(openClaim).length}
              canDelete={canDeleteClaim(openClaim)}
              rejecting={rejectDraft?.claimId === openClaim.id}
              busyAction={busyAction}
              onApprove={() => handleApprove(openClaim)}
              onApproveAndPay={() => handleApproveAndPay(openClaim)}
              onStartReject={() => setRejectDraft({ claimId: openClaim.id, reason: "" })}
              onCancelReject={() => setRejectDraft(null)}
              onConfirmReject={() => handleReject(openClaim)}
              onDelete={() => handleDeleteClaim(openClaim)}
              onMarkPaid={() => handleMarkPaid(openClaim)}
              onPay={() => setPayClaimId(openClaim.id)}
              onClose={() => setOpenClaimId(null)}
            />
          ) : undefined
        }
      >
        {openClaim && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Claimant">{openClaim.claimant.name}</ModalDefinitionRow>
              {openClaim.approver && (
                <ModalDefinitionRow label="Sent to">{openClaim.approver.userId === selfId ? "You" : openClaim.approver.name}</ModalDefinitionRow>
              )}
              <ModalDefinitionRow label="Month">{monthLabel(openClaim.month)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Status">
                <Badge variant={CLAIM_STATUS_META[openClaim.status].variant}>{CLAIM_STATUS_META[openClaim.status].label}</Badge>
              </ModalDefinitionRow>
              <ModalDefinitionRow label={provider.name}>
                {openClaim.publishedAt ? (
                  openClaim.billUrl ? (
                    <a
                      href={openClaim.billUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-[var(--space-xs)] font-semibold text-accent hover:underline"
                    >
                      Posted {shortDate(openClaim.publishedAt)}
                      <ExternalLink size={14} strokeWidth={2.25} />
                    </a>
                  ) : (
                    <Badge variant="success">Posted {shortDate(openClaim.publishedAt)}</Badge>
                  )
                ) : (
                  <Badge variant="neutral">{openClaim.status === "rejected" ? "Never posted" : "Posted when approved"}</Badge>
                )}
              </ModalDefinitionRow>
              {openClaim.approvedAt && <ModalDefinitionRow label="Approved">{shortDate(openClaim.approvedAt)}</ModalDefinitionRow>}
              {openClaim.rejectedAt && <ModalDefinitionRow label="Rejected">{shortDate(openClaim.rejectedAt)}</ModalDefinitionRow>}
              {openClaim.paidAt && (
                <ModalDefinitionRow label="Paid on">
                  {shortDate(openClaim.paidAt)}
                  {openClaim.paidVia === "accounting" ? ` · payment recorded in ${provider.name}` : " · marked as paid"}
                </ModalDefinitionRow>
              )}
            </div>

            <div>
              <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">Receipts</p>
              <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-sm)]">
                {openClaim.receipts.map((receipt) => (
                  <div key={receipt.id} className="rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
                    <div className="flex items-start justify-between gap-[var(--space-sm)]">
                      <div className="min-w-0">
                        <p className="truncate text-body-sm font-semibold text-content-primary">{receipt.vendor}</p>
                        <p className="text-caption text-content-secondary">
                          {shortDate(receipt.date)} · {receipt.glAccount ?? (receipt.glAccountId ? "GL account set" : "No GL account")} · Tax{" "}
                          {money(receipt.tax, receipt.currency)}
                        </p>
                        {noteDraft?.receiptId === receipt.id ? null : receipt.note && (
                          <p className="text-caption italic text-content-muted">&ldquo;{receipt.note}&rdquo;</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-[var(--space-xs)]">
                        <span className="text-body-sm font-bold text-content-primary">{money(receipt.amount, receipt.currency)}</span>
                        <Badge variant="neutral">{receipt.source}</Badge>
                      </div>
                    </div>
                    {noteDraft?.receiptId === receipt.id && (
                      <div className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-xs)] sm:flex-row">
                        <input
                          type="text"
                          autoFocus
                          aria-label={`Note for ${receipt.vendor}`}
                          placeholder="e.g. client lunch with Acme"
                          maxLength={500}
                          value={noteDraft.text}
                          onChange={(e) => setNoteDraft({ receiptId: receipt.id, text: e.target.value })}
                          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-[var(--space-sm)] text-body-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                        />
                        <div className="flex gap-[var(--space-xs)]">
                          <Button size="sm" onClick={() => handleSaveNote(openClaim)} loading={busyAction === "note"} disabled={!!busyAction}>
                            Save
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setNoteDraft(null)} disabled={busyAction === "note"}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="mt-[var(--space-xs)] flex flex-wrap items-center gap-[var(--space-sm)]">
                      {/* An approver fixes GL/tax/amounts on the usual review screen while the claim is in review. */}
                      <Link
                        href={approver && openClaim.status === "awaiting_review" ? `/invoices/${receipt.id}/review` : `/invoices/${receipt.id}`}
                        className="inline-flex items-center gap-[var(--space-xs)] text-caption font-bold text-accent hover:underline"
                      >
                        {approver && openClaim.status === "awaiting_review" ? "Review" : "Open receipt"}
                      </Link>
                      {canEditReceipts(openClaim) && noteDraft?.receiptId !== receipt.id && (
                        <button
                          type="button"
                          onClick={() => setNoteDraft({ receiptId: receipt.id, text: receipt.note ?? "" })}
                          disabled={!!busyAction}
                          className="text-caption font-bold text-accent hover:underline disabled:opacity-60"
                        >
                          {receipt.note ? "Edit note" : "Add note"}
                        </button>
                      )}
                      {canEditReceipts(openClaim) && (
                        <button
                          type="button"
                          onClick={() => handleRemoveReceipt(openClaim, receipt)}
                          disabled={!!busyAction}
                          className="inline-flex items-center gap-[var(--space-xs)] rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-error hover:bg-error/10 disabled:opacity-60"
                        >
                          <Trash2 size={14} strokeWidth={2.25} />
                          Remove receipt
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]">
              <div className="flex items-center justify-between text-body-sm text-content-secondary">
                <span>Tax</span>
                <span>{money(openClaim.tax, openClaim.currency)}</span>
              </div>
              <div className="mt-[var(--space-xs)] flex items-center justify-between text-body font-bold text-content-primary">
                <span>Total to reimburse</span>
                <span>{money(openClaim.total, openClaim.currency)}</span>
              </div>
            </div>

            {openClaim.status === "rejected" && (
              <div className="rounded-md border border-status-danger-border bg-status-danger-bg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-status-danger-text">
                <p className="font-semibold">Rejected{openClaim.rejectionReason ? ":" : ""}</p>
                {openClaim.rejectionReason && <p>{openClaim.rejectionReason}</p>}
                <p className="mt-[var(--space-xs)] text-caption">
                  Nothing was sent to {provider.name}. Delete the claim to put its receipts on a new one.
                </p>
              </div>
            )}
            {rejectDraft?.claimId === openClaim.id && (
              <div className="flex flex-col gap-[var(--space-xs)]">
                <label htmlFor="reject-reason" className="text-body-sm font-semibold text-content-primary">
                  Why is it rejected? <span className="font-normal text-content-secondary">(the claimant sees this)</span>
                </label>
                <textarea
                  id="reject-reason"
                  autoFocus
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. Personal expense, not a business one"
                  value={rejectDraft.reason}
                  onChange={(e) => setRejectDraft({ claimId: openClaim.id, reason: e.target.value })}
                  className="w-full rounded-md border border-border bg-page px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            )}
            {approver && openClaim.status === "awaiting_review" && uncoded(openClaim).length > 0 && (
              <p className="text-caption font-semibold text-status-warning-text">
                Pick a GL account for {uncoded(openClaim).map((r) => r.vendor).join(", ")} before approving — use Review on the receipt.
              </p>
            )}
            {approver && openClaim.status === "awaiting_review" && !canAct(openClaim) && (
              <p className="text-caption text-content-secondary">
                This claim was sent to {openClaim.approver?.name} — only they, an owner or an admin can approve or reject it.
              </p>
            )}
            {approver && openClaim.status === "awaiting_review" && canAct(openClaim) && selfApprovalBlocked(openClaim) && (
              <p className="text-caption text-content-secondary">
                This claim is yours or you created it, so someone else on the team has to approve it. An owner or admin can allow self-approval in
                Settings.
              </p>
            )}
            {openClaim.status === "paid" && openClaim.publishedAt && (
              <p className="text-caption text-content-secondary">This claim was reimbursed on {shortDate(openClaim.paidAt)} and is read-only.</p>
            )}
          </div>
        )}
      </Modal>

      <PayEmployeeModal
        target={payTarget}
        providerName={provider.name}
        onPay={async (target, bankAccountId, date) => {
          const r = await dispatch(payExpenseClaim({ id: target.id, bankAccountId, date }));
          return { ok: payExpenseClaim.fulfilled.match(r), payload: r.payload };
        }}
        onClose={() => setPayClaimId(null)}
      />
    </>
  );
}

interface ClaimFooterProps {
  claim: ExpenseClaimDto;
  providerName: string;
  approver: boolean;
  selfApprovalBlocked: boolean;
  /** The claim was sent to this user, or they're an owner/admin. */
  canAct: boolean;
  uncodedCount: number;
  canDelete: boolean;
  /** The reject reason box is open. */
  rejecting: boolean;
  busyAction: BusyAction | null;
  onApprove: () => void;
  onApproveAndPay: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onConfirmReject: () => void;
  onDelete: () => void;
  onMarkPaid: () => void;
  onPay: () => void;
  onClose: () => void;
}

function ClaimFooter({
  claim,
  providerName,
  approver,
  selfApprovalBlocked,
  canAct,
  uncodedCount,
  canDelete,
  rejecting,
  busyAction,
  onApprove,
  onApproveAndPay,
  onStartReject,
  onCancelReject,
  onConfirmReject,
  onDelete,
  onMarkPaid,
  onPay,
  onClose,
}: ClaimFooterProps) {
  const disabled = !!busyAction;
  const row = "flex w-full flex-wrap justify-end gap-[var(--space-sm)]";
  const closeButton = (
    <Button variant="outline" size="sm" onClick={onClose} disabled={disabled}>
      Close
    </Button>
  );
  const deleteButton = canDelete && (
    <Button variant="outline" size="sm" onClick={onDelete} loading={busyAction === "deleteClaim"} disabled={disabled}>
      Delete claim
    </Button>
  );

  if (rejecting) {
    return (
      <div className={row}>
        <Button variant="outline" size="sm" onClick={onCancelReject} disabled={disabled}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirmReject} loading={busyAction === "reject"} disabled={disabled}>
          Reject claim
        </Button>
      </div>
    );
  }
  if (claim.status === "awaiting_review" && approver && canAct) {
    const approveBlocked = disabled || selfApprovalBlocked || uncodedCount > 0;
    return (
      <div className={row}>
        {deleteButton}
        <Button variant="outline" size="sm" onClick={onStartReject} disabled={disabled}>
          Reject
        </Button>
        <Button variant="outline" size="sm" onClick={onApproveAndPay} loading={busyAction === "approvePay"} disabled={approveBlocked}>
          Approve & mark paid
        </Button>
        <Button size="sm" onClick={onApprove} loading={busyAction === "approve"} disabled={approveBlocked}>
          Approve & post to {providerName}
        </Button>
      </div>
    );
  }
  if (claim.status === "awaiting_reimbursement" && approver) {
    return (
      <div className={row}>
        <Button variant="outline" size="sm" onClick={onPay} disabled={disabled}>
          Pay employee
        </Button>
        <Button size="sm" onClick={onMarkPaid} loading={busyAction === "markPaid"} disabled={disabled}>
          Mark as paid
        </Button>
      </div>
    );
  }
  return (
    <div className={row}>
      {deleteButton}
      {closeButton}
    </div>
  );
}
