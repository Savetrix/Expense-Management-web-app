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
  markExpenseClaimPaid,
  publishExpenseClaim,
  removeClaimReceipt,
  reopenExpenseClaim,
  updateReceiptNote,
  type ClaimReceiptDto,
  type ClaimStatus,
  type ExpenseClaimDto,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { PayClaimModal } from "./PayClaimModal";
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

const STATUS_ORDER: ClaimStatus[] = ["awaiting_review", "awaiting_reimbursement", "paid"];

export const claimTitle = (claim: Pick<ExpenseClaimDto, "claimant" | "month">) => `${claim.claimant.name} — ${monthLabel(claim.month)}`;

type BusyAction = "approve" | "approvePay" | "publish" | "markPaid" | "removeReceipt" | "reopen" | "note";

export function ClaimsTab({ claims, loading, error, onRetry, role, selfId, allowSelfApproval, onNewClaim }: ClaimsTabProps) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const approver = isApprover(role);
  const [status, setStatus] = useState<ClaimStatus>("awaiting_review");
  const [search, setSearch] = useState("");
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [payClaimId, setPayClaimId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ receiptId: string; text: string } | null>(null);

  const counts = useMemo(() => {
    const c: Record<ClaimStatus, number> = { awaiting_review: 0, awaiting_reimbursement: 0, paid: 0 };
    claims.forEach((cl) => (c[cl.status] += 1));
    return c;
  }, [claims]);

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return claims
      .filter((c) => c.status === status)
      .filter((c) => !lower || claimTitle(c).toLowerCase().includes(lower))
      .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.claimant.name.localeCompare(b.claimant.name)));
  }, [claims, status, search]);

  const openClaim = claims.find((c) => c.id === openClaimId) ?? null;

  // Nobody approves a claim they created or that's theirs, unless the company
  // allows it (Settings). The backend enforces the same rule.
  const isOwnClaim = (claim: ExpenseClaimDto) => claim.createdBy === selfId || claim.claimant.userId === selfId;
  const selfApprovalBlocked = (claim: ExpenseClaimDto) => isOwnClaim(claim) && !allowSelfApproval;
  // Publishing needs a GL account on every receipt, and receipts are frozen
  // once approved — so the backend refuses approval until they're coded.
  const uncoded = (claim: ExpenseClaimDto) => claim.receipts.filter((r) => !r.glAccountId);

  const run = async <T,>(key: BusyAction, action: () => Promise<{ ok: boolean; payload: T }>, success: string, fallback: string) => {
    setBusyAction(key);
    const { ok, payload } = await action();
    setBusyAction(null);
    if (ok) showToast(success, "success");
    else showToast(errorMessage(payload, fallback), "error");
    return ok;
  };

  const handleApprove = (claim: ExpenseClaimDto) =>
    run(
      "approve",
      async () => {
        const r = await dispatch(approveExpenseClaim({ id: claim.id }));
        return { ok: approveExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} approved — now awaiting reimbursement.`,
      "Couldn't approve the claim.",
    );

  const handleApproveAndPay = async (claim: ExpenseClaimDto) => {
    const ok = await confirmDialog({
      title: "Approve and mark as paid?",
      message: `This approves ${claimTitle(claim)} and records that ${claim.claimant.name} has been paid ${money(claim.total, claim.currency)}. Scantrix doesn't send the money — pay them as you usually do.`,
      confirmLabel: "Approve & mark paid",
    });
    if (!ok) return;
    await run(
      "approvePay",
      async () => {
        const r = await dispatch(approveExpenseClaim({ id: claim.id, pay: true }));
        return { ok: approveExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} approved and marked as paid.`,
      "Couldn't approve the claim.",
    );
  };

  const handlePublish = async (claim: ExpenseClaimDto) => {
    const ok = await confirmDialog({
      title: `Publish to ${provider.name}?`,
      message: `This creates one bill in ${provider.name} payable to ${claim.claimant.name} for ${money(claim.total, claim.currency)}, with every receipt attached. If ${claim.claimant.name} isn't a vendor there yet, they're added as one.`,
      confirmLabel: "Publish",
    });
    if (!ok) return;
    await run(
      "publish",
      async () => {
        const r = await dispatch(publishExpenseClaim(claim.id));
        return { ok: publishExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} published to ${provider.name} as a bill payable to ${claim.claimant.name}.`,
      "Couldn't publish the claim.",
    );
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

  const handleReopen = async (claim: ExpenseClaimDto) => {
    const ok = await confirmDialog({
      title: "Send back to review?",
      message: `${claimTitle(claim)} goes back to Awaiting review so its receipts can be fixed or removed. It has to be approved again before it's published.`,
      confirmLabel: "Send back to review",
    });
    if (!ok) return;
    await run(
      "reopen",
      async () => {
        const r = await dispatch(reopenExpenseClaim(claim.id));
        return { ok: reopenExpenseClaim.fulfilled.match(r), payload: r.payload };
      },
      `${claimTitle(claim)} is back in Awaiting review.`,
      "Couldn't send the claim back to review.",
    );
    setStatus("awaiting_review");
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
        ? `${receipt.vendor} is the only receipt on this claim, so removing it also deletes the claim. The receipt goes back to your pending invoices.`
        : `${receipt.vendor} (${money(receipt.amount, receipt.currency)}) will be taken off this claim and go back to your pending invoices.`,
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

  const emptyCopy: Record<ClaimStatus, { title: string; description: string }> = {
    awaiting_review: {
      title: "No claims to review",
      description: "Group an employee's out-of-pocket receipts into a claim — it waits here for review before anything is published.",
    },
    awaiting_reimbursement: {
      title: "Nothing awaiting reimbursement",
      description: "Approved claims wait here until the employee has been paid back.",
    },
    paid: { title: "No paid claims yet", description: "Claims you've reimbursed are kept here for reference." },
  };

  const canEditReceipts = (claim: ExpenseClaimDto) => claim.status === "awaiting_review" && (approver || claim.createdBy === selfId);

  return (
    <>
      <div className="mt-[var(--space-md)]">
        <RoleInfoBanner>
          {approver
            ? "Expense claims are never published automatically — every claim waits here for someone to review it first."
            : "You see the claims you created or that are yours. Someone with approval rights reviews, publishes and reimburses them."}
        </RoleInfoBanner>
      </div>

      <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
        <div className={TOOLBAR_CLASS}>
          <div className="max-w-full overflow-x-auto">
            <Tabs
              items={STATUS_ORDER.map((s) => ({ value: s, label: CLAIM_STATUS_META[s].label, count: counts[s] }))}
              value={status}
              onChange={(v) => setStatus(v as ClaimStatus)}
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
              actionLabel={status === "awaiting_review" ? "New expense claim" : undefined}
              onAction={status === "awaiting_review" ? onNewClaim : undefined}
            />
          )
        ) : (
          <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
            {visible.map((claim) => (
              <CompactListRow
                key={claim.id}
                title={claimTitle(claim)}
                meta={`${claim.receipts.length} receipt${claim.receipts.length === 1 ? "" : "s"}${
                  claim.status === "paid" ? ` · Paid ${shortDate(claim.paidAt)}` : ` · Created ${shortDate(claim.createdAt)}`
                }${claim.publishedAt ? " · Published" : ""}`}
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
              uncodedCount={uncoded(openClaim).length}
              busyAction={busyAction}
              onApprove={() => handleApprove(openClaim)}
              onApproveAndPay={() => handleApproveAndPay(openClaim)}
              onPublish={() => handlePublish(openClaim)}
              onMarkPaid={() => handleMarkPaid(openClaim)}
              onReopen={() => handleReopen(openClaim)}
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
                      Published {shortDate(openClaim.publishedAt)}
                      <ExternalLink size={14} strokeWidth={2.25} />
                    </a>
                  ) : (
                    <Badge variant="success">Published {shortDate(openClaim.publishedAt)}</Badge>
                  )
                ) : (
                  <Badge variant="neutral">Not published</Badge>
                )}
              </ModalDefinitionRow>
              {openClaim.approvedAt && <ModalDefinitionRow label="Approved">{shortDate(openClaim.approvedAt)}</ModalDefinitionRow>}
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
                      <Link
                        href={`/invoices/${receipt.id}`}
                        className="inline-flex items-center gap-[var(--space-xs)] text-caption font-bold text-accent hover:underline"
                      >
                        Open receipt
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

            {approver && openClaim.status === "awaiting_review" && uncoded(openClaim).length > 0 && (
              <p className="text-caption font-semibold text-status-warning-text">
                Pick a GL account for {uncoded(openClaim).map((r) => r.vendor).join(", ")} before approving — open the receipt to code it.
              </p>
            )}
            {approver && openClaim.status === "awaiting_reimbursement" && !openClaim.publishedAt && (
              <p className="text-caption text-content-secondary">
                Publishing refused, or a receipt needs changing? Send the claim back to review to fix or remove receipts.
              </p>
            )}
            {approver && openClaim.status === "awaiting_review" && selfApprovalBlocked(openClaim) && (
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

      <PayClaimModal claim={claims.find((c) => c.id === payClaimId) ?? null} providerName={provider.name} onClose={() => setPayClaimId(null)} />
    </>
  );
}

interface ClaimFooterProps {
  claim: ExpenseClaimDto;
  providerName: string;
  approver: boolean;
  selfApprovalBlocked: boolean;
  uncodedCount: number;
  busyAction: BusyAction | null;
  onApprove: () => void;
  onApproveAndPay: () => void;
  onPublish: () => void;
  onMarkPaid: () => void;
  onReopen: () => void;
  onPay: () => void;
  onClose: () => void;
}

function ClaimFooter({
  claim,
  providerName,
  approver,
  selfApprovalBlocked,
  uncodedCount,
  busyAction,
  onApprove,
  onApproveAndPay,
  onPublish,
  onMarkPaid,
  onReopen,
  onPay,
  onClose,
}: ClaimFooterProps) {
  const disabled = !!busyAction;
  const closeButton = (
    <Button variant="outline" size="sm" onClick={onClose} disabled={disabled}>
      Close
    </Button>
  );
  if (!approver) return closeButton;

  const publishButton = !claim.publishedAt && (
    <Button variant="outline" size="sm" onClick={onPublish} loading={busyAction === "publish"} disabled={disabled}>
      Publish to {providerName}
    </Button>
  );

  if (claim.status === "paid") {
    return <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">{publishButton || closeButton}</div>;
  }
  if (claim.status === "awaiting_reimbursement") {
    return (
      <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
        {!claim.publishedAt && (
          <Button variant="outline" size="sm" onClick={onReopen} loading={busyAction === "reopen"} disabled={disabled}>
            Send back to review
          </Button>
        )}
        {publishButton}
        <Button
          variant="outline"
          size="sm"
          onClick={onPay}
          disabled={disabled || !claim.publishedAt}
          title={claim.publishedAt ? undefined : `Publish to ${providerName} first — the payment is recorded against its bill`}
        >
          Pay employee
        </Button>
        <Button size="sm" onClick={onMarkPaid} loading={busyAction === "markPaid"} disabled={disabled}>
          Mark as paid
        </Button>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" onClick={onApproveAndPay} loading={busyAction === "approvePay"} disabled={disabled || selfApprovalBlocked || uncodedCount > 0}>
        Approve & mark paid
      </Button>
      <Button size="sm" onClick={onApprove} loading={busyAction === "approve"} disabled={disabled || selfApprovalBlocked || uncodedCount > 0}>
        Approve
      </Button>
    </div>
  );
}
