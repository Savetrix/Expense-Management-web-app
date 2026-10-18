"use client";

import { ChevronRight, Lightbulb, Receipt, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompactListRow, Modal, ModalDefinitionRow, RoleInfoBanner, SearchInput, Tabs } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { ClaimReceipt, ClaimStatus, ExpenseClaim } from "./types";
import { CARD_CLASS, CLAIM_STATUS_META, TOOLBAR_CLASS, claimTax, claimTotal, money, monthLabel, shortDate, todayIso } from "./shared";

interface ClaimsTabProps {
  claims: ExpenseClaim[];
  onChangeClaims: (updater: (prev: ExpenseClaim[]) => ExpenseClaim[]) => void;
  /** A receipt removed from a claim goes back to the unposted pool. */
  onReturnReceipt: (receipt: ClaimReceipt) => void;
  onNewClaim: () => void;
}

const STATUS_ORDER: ClaimStatus[] = ["awaiting_review", "awaiting_reimbursement", "paid"];

export const claimTitle = (claim: Pick<ExpenseClaim, "claimant" | "month">) => `${claim.claimant} — ${monthLabel(claim.month)}`;

export function ClaimsTab({ claims, onChangeClaims, onReturnReceipt, onNewClaim }: ClaimsTabProps) {
  const provider = useActiveProvider();
  const [status, setStatus] = useState<ClaimStatus>("awaiting_review");
  const [search, setSearch] = useState("");
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

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
      .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.claimant.localeCompare(b.claimant)));
  }, [claims, status, search]);

  const openClaim = claims.find((c) => c.id === openClaimId) ?? null;

  const updateClaim = (id: string, patch: Partial<ExpenseClaim>) =>
    onChangeClaims((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Every claim action needs the backend; the short delay stands in for the
  // request so the loading state is visible while clicking through.
  const runAction = async (key: string, label: string, apply: () => void, successMessage: string) => {
    setBusyAction(key);
    await new Promise((resolve) => setTimeout(resolve, 450));
    apply();
    setBusyAction(null);
    notifyBackendPending(label);
    showToast(successMessage, "success");
  };

  const handleApprove = (claim: ExpenseClaim) =>
    runAction(
      "approve",
      "Approve",
      () => updateClaim(claim.id, { status: "awaiting_reimbursement", approvedAt: todayIso() }),
      `${claimTitle(claim)} approved — now awaiting reimbursement.`,
    );

  const handleApproveAndPay = async (claim: ExpenseClaim) => {
    const ok = await confirmDialog({
      title: "Approve and pay?",
      message: `This approves ${claimTitle(claim)} and pays ${money(claimTotal(claim.receipts))} to ${claim.claimant} in one step.`,
      confirmLabel: beLabel("Approve & pay"),
    });
    if (!ok) return;
    const today = todayIso();
    await runAction(
      "approvePay",
      "Approve & pay",
      () => updateClaim(claim.id, { status: "paid", approvedAt: today, paidAt: today }),
      `${claimTitle(claim)} approved and paid.`,
    );
  };

  const handlePublish = (claim: ExpenseClaim) =>
    runAction(
      "publish",
      `Publish to ${provider.name}`,
      () => updateClaim(claim.id, { publishedAt: todayIso() }),
      `${claimTitle(claim)} published to ${provider.name} as a bill payable to ${claim.claimant}.`,
    );

  const handleMarkPaid = (claim: ExpenseClaim) =>
    runAction(
      "markPaid",
      "Mark as paid",
      () => updateClaim(claim.id, { status: "paid", paidAt: todayIso() }),
      `${claimTitle(claim)} marked as paid.`,
    );

  const handlePayEmployee = async (claim: ExpenseClaim) => {
    const ok = await confirmDialog({
      title: `Pay ${claim.claimant}?`,
      message: `Send ${money(claimTotal(claim.receipts))} to ${claim.claimant}'s bank account. The payment is recorded against the claim in ${provider.name} once the bank confirms.`,
      confirmLabel: beLabel("Pay employee"),
    });
    if (!ok) return;
    await runAction(
      "payEmployee",
      "Pay employee",
      () => updateClaim(claim.id, { status: "paid", paidAt: todayIso() }),
      `Payment to ${claim.claimant} sent.`,
    );
  };

  const handleRemoveReceipt = async (claim: ExpenseClaim, receipt: ClaimReceipt) => {
    const isLast = claim.receipts.length === 1;
    const ok = await confirmDialog({
      title: "Remove receipt?",
      message: isLast
        ? `${receipt.vendor} is the only receipt on this claim, so removing it also deletes the claim. The receipt goes back to your unposted receipts.`
        : `${receipt.vendor} (${money(receipt.amount)}) will be taken off this claim and go back to your unposted receipts.`,
      confirmLabel: beLabel("Remove receipt"),
      tone: "destructive",
    });
    if (!ok) return;
    notifyBackendPending("Remove receipt");
    onReturnReceipt(receipt);
    if (isLast) {
      onChangeClaims((prev) => prev.filter((c) => c.id !== claim.id));
      setOpenClaimId(null);
    } else {
      updateClaim(claim.id, { receipts: claim.receipts.filter((r) => r.id !== receipt.id) });
    }
  };

  const emptyCopy: Record<ClaimStatus, { title: string; description: string }> = {
    awaiting_review: {
      title: "No claims to review",
      description: "Receipts sent in with an expense note, or grouped by you, land here for review before anything is published.",
    },
    awaiting_reimbursement: {
      title: "Nothing awaiting reimbursement",
      description: "Approved claims wait here until the employee has been paid back.",
    },
    paid: { title: "No paid claims yet", description: "Claims you've reimbursed are kept here for reference." },
  };

  return (
    <>
      <div className="mt-[var(--space-md)]">
        <RoleInfoBanner>
          Expense claims are never published automatically — every claim waits here for someone to review it first.
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

        {visible.length === 0 ? (
          search.trim() && counts[status] > 0 ? (
            <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">
              No claims match &quot;{search}&quot;.
            </div>
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
                }${claim.publishedAt ? ` · Published` : ""}`}
                onClick={() => setOpenClaimId(claim.id)}
                trailing={
                  <span className="flex shrink-0 items-center gap-[var(--space-sm)]">
                    <span className="text-body-sm font-bold text-content-primary">{money(claimTotal(claim.receipts))}</span>
                    <ChevronRight size={18} strokeWidth={2} className="text-content-muted" />
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-[var(--space-md)] flex items-start gap-[var(--space-sm)] rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-content-secondary">
        <Lightbulb size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
        <p>
          Tip: upload a receipt with a note such as <span className="font-semibold text-content-primary">&quot;expense for Sam&quot;</span> and
          it&apos;s grouped automatically into Sam&apos;s claim for the month on the receipt — no manual grouping needed.
        </p>
      </div>

      <Modal
        open={!!openClaim}
        onClose={() => !busyAction && setOpenClaimId(null)}
        title={openClaim ? claimTitle(openClaim) : ""}
        widthClassName="max-w-2xl"
        footer={
          openClaim ? (
            <ClaimFooter
              claim={openClaim}
              providerName={provider.name}
              busyAction={busyAction}
              onApprove={() => handleApprove(openClaim)}
              onApproveAndPay={() => handleApproveAndPay(openClaim)}
              onPublish={() => handlePublish(openClaim)}
              onMarkPaid={() => handleMarkPaid(openClaim)}
              onPayEmployee={() => handlePayEmployee(openClaim)}
              onClose={() => setOpenClaimId(null)}
            />
          ) : undefined
        }
      >
        {openClaim && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Claimant">{openClaim.claimant}</ModalDefinitionRow>
              <ModalDefinitionRow label="Month">{monthLabel(openClaim.month)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Status">
                <Badge variant={CLAIM_STATUS_META[openClaim.status].variant}>{CLAIM_STATUS_META[openClaim.status].label}</Badge>
              </ModalDefinitionRow>
              <ModalDefinitionRow label={provider.name}>
                {openClaim.publishedAt ? (
                  <Badge variant="success">Published {shortDate(openClaim.publishedAt)}</Badge>
                ) : (
                  <Badge variant="neutral">Not published</Badge>
                )}
              </ModalDefinitionRow>
              {openClaim.approvedAt && <ModalDefinitionRow label="Approved">{shortDate(openClaim.approvedAt)}</ModalDefinitionRow>}
              {openClaim.paidAt && <ModalDefinitionRow label="Paid on">{shortDate(openClaim.paidAt)}</ModalDefinitionRow>}
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
                          {shortDate(receipt.date)}{receipt.glAccount ? ` · ${receipt.glAccount}` : ""} · Tax {money(receipt.tax)}
                        </p>
                        {receipt.note && <p className="text-caption italic text-content-muted">&ldquo;{receipt.note}&rdquo;</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-[var(--space-xs)]">
                        <span className="text-body-sm font-bold text-content-primary">{money(receipt.amount)}</span>
                        {receipt.source && <Badge variant="neutral">{receipt.source}</Badge>}
                      </div>
                    </div>
                    {openClaim.status === "awaiting_review" && (
                      <button
                        type="button"
                        onClick={() => handleRemoveReceipt(openClaim, receipt)}
                        disabled={!!busyAction}
                        className="mt-[var(--space-xs)] inline-flex items-center gap-[var(--space-xs)] rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-error hover:bg-error/10 disabled:opacity-60"
                      >
                        <Trash2 size={14} strokeWidth={2.25} />
                        {beLabel("Remove receipt")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]">
              <div className="flex items-center justify-between text-body-sm text-content-secondary">
                <span>Tax</span>
                <span>{money(claimTax(openClaim.receipts))}</span>
              </div>
              <div className="mt-[var(--space-xs)] flex items-center justify-between text-body font-bold text-content-primary">
                <span>Total to reimburse</span>
                <span>{money(claimTotal(openClaim.receipts))}</span>
              </div>
            </div>

            {openClaim.status === "paid" && (
              <p className="text-caption text-content-secondary">
                This claim was reimbursed on {shortDate(openClaim.paidAt)} and is read-only.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

interface ClaimFooterProps {
  claim: ExpenseClaim;
  providerName: string;
  busyAction: string | null;
  onApprove: () => void;
  onApproveAndPay: () => void;
  onPublish: () => void;
  onMarkPaid: () => void;
  onPayEmployee: () => void;
  onClose: () => void;
}

function ClaimFooter({ claim, providerName, busyAction, onApprove, onApproveAndPay, onPublish, onMarkPaid, onPayEmployee, onClose }: ClaimFooterProps) {
  const disabled = !!busyAction;
  if (claim.status === "paid") {
    return (
      <Button variant="outline" size="sm" onClick={onClose}>
        Close
      </Button>
    );
  }
  if (claim.status === "awaiting_reimbursement") {
    return (
      <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
        <Button variant="outline" size="sm" onClick={onMarkPaid} loading={busyAction === "markPaid"} disabled={disabled}>
          {beLabel("Mark as paid")}
        </Button>
        <Button size="sm" onClick={onPayEmployee} loading={busyAction === "payEmployee"} disabled={disabled}>
          {beLabel("Pay employee")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
      {!claim.publishedAt && (
        <Button variant="outline" size="sm" onClick={onPublish} loading={busyAction === "publish"} disabled={disabled}>
          {beLabel(`Publish to ${providerName}`)}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={onApproveAndPay} loading={busyAction === "approvePay"} disabled={disabled}>
        {beLabel("Approve & pay")}
      </Button>
      <Button size="sm" onClick={onApprove} loading={busyAction === "approve"} disabled={disabled}>
        {beLabel("Approve")}
      </Button>
    </div>
  );
}
