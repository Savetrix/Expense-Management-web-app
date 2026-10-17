"use client";

import { Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ModalDefinitionRow } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";

import type { Bill, PayVendor, PayingAccount, TeamMember } from "./mockData";
import { CARD_CLASS, delay, isOverdue, maskNumber, money, shortDate } from "./shared";

interface AwaitingApprovalTabProps {
  bills: Bill[];
  vendors: PayVendor[];
  team: TeamMember[];
  defaultAccount: PayingAccount | undefined;
  onApprove: (bill: Bill) => void;
  onApproveAndPay: (bill: Bill) => void;
  onReject: (bill: Bill, reason: string) => void;
}

export function AwaitingApprovalTab({ bills, vendors, team, defaultAccount, onApprove, onApproveAndPay, onReject }: AwaitingApprovalTabProps) {
  const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);
  const [rejecting, setRejecting] = useState<Bill | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "Unknown vendor";
  const memberName = (id?: string) => team.find((m) => m.id === id)?.name ?? "Approver";

  const run = async (bill: Bill, action: string, apply: () => void, label: string, message: string) => {
    setBusy({ id: bill.id, action });
    await delay();
    apply();
    setBusy(null);
    notifyBackendPending(label);
    showToast(message, "success");
  };

  const handleApprove = (bill: Bill) =>
    run(bill, "approve", () => onApprove(bill), "Approve", `${vendorName(bill.vendorId)} ${bill.reference} approved — it's back in To pay, ready for a run.`);

  const handleApproveAndPay = async (bill: Bill) => {
    const ok = await confirmDialog({
      title: "Approve and pay now?",
      message: `Pay ${money(bill.amount)} to ${vendorName(bill.vendorId)}${defaultAccount ? ` from ${defaultAccount.name} (${maskNumber(defaultAccount.mask)})` : ""}.`,
      confirmLabel: beLabel("Approve & pay"),
    });
    if (!ok) return;
    await run(bill, "approvePay", () => onApproveAndPay(bill), "Approve & pay", `Approved and paid — see Payment runs for progress.`);
  };

  const openReject = (bill: Bill) => {
    setReason("");
    setReasonError("");
    setRejecting(bill);
  };

  const submitReject = async () => {
    if (!rejecting) return;
    if (!reason.trim()) {
      setReasonError("Add a short reason so the requester knows what to fix.");
      return;
    }
    const bill = rejecting;
    setBusy({ id: bill.id, action: "reject" });
    await delay();
    onReject(bill, reason.trim());
    setBusy(null);
    setRejecting(null);
    notifyBackendPending("Reject");
    showToast(`Payment for ${bill.reference} rejected. The bill stays unpaid in To pay.`, "success");
  };

  return (
    <>
      <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
        <div className="flex items-start gap-[var(--space-sm)] border-b border-border bg-page p-[var(--space-md)] text-body-sm text-content-secondary">
          <Mail size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
          <p>Approvers are emailed when a payment needs them and can approve from the email without logging in.</p>
        </div>

        {bills.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={28} strokeWidth={1.75} />}
            title="Nothing waiting for approval"
            description="Payments that go over your approval rules wait here until an approver signs off."
          />
        ) : (
          <div className="flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]">
            {bills.map((bill) => {
              const isBusy = busy?.id === bill.id;
              return (
                <article key={bill.id} className="rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)]">
                  <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-semibold text-content-primary">
                        {vendorName(bill.vendorId)} · {bill.reference}
                      </p>
                      <p className="text-caption text-content-secondary">
                        Approver: {memberName(bill.approverId)} · Requested {shortDate(bill.requestedAt)}
                        {bill.requestedBy ? ` by ${bill.requestedBy}` : ""}
                      </p>
                      <p className="mt-[var(--space-xs)] flex flex-wrap items-center gap-[var(--space-xs)] text-caption text-content-secondary">
                        Due {shortDate(bill.dueDate)}
                        {isOverdue(bill) && <Badge variant="error">Overdue</Badge>}
                      </p>
                    </div>
                    <span className="shrink-0 text-body font-bold text-content-primary">{money(bill.amount)}</span>
                  </div>
                  <div className="mt-[var(--space-sm)] flex flex-wrap justify-end gap-[var(--space-sm)]">
                    <button
                      type="button"
                      onClick={() => openReject(bill)}
                      disabled={!!busy}
                      className="rounded-pill px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-bold text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {beLabel("Reject")}
                    </button>
                    <Button variant="outline" size="sm" onClick={() => handleApproveAndPay(bill)} loading={isBusy && busy?.action === "approvePay"} disabled={!!busy}>
                      {beLabel("Approve & pay")}
                    </Button>
                    <Button size="sm" onClick={() => handleApprove(bill)} loading={isBusy && busy?.action === "approve"} disabled={!!busy}>
                      {beLabel("Approve")}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={!!rejecting}
        onClose={() => busy?.action !== "reject" && setRejecting(null)}
        title="Reject payment"
        footer={
          <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
            <Button variant="outline" size="sm" onClick={() => setRejecting(null)} disabled={busy?.action === "reject"}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={submitReject} loading={busy?.action === "reject"} disabled={busy?.action === "reject"}>
              {beLabel("Reject")}
            </Button>
          </div>
        }
      >
        {rejecting && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Vendor">{vendorName(rejecting.vendorId)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Reference">{rejecting.reference}</ModalDefinitionRow>
              <ModalDefinitionRow label="Amount">{money(rejecting.amount)}</ModalDefinitionRow>
            </div>
            <div>
              <label htmlFor="reject-reason" className="text-body-sm font-semibold text-content-primary">
                Reason *
              </label>
              <textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="e.g. Amount doesn't match the purchase order"
                className={`mt-[var(--space-xs)] w-full rounded-md border bg-surface px-[var(--space-md)] py-[var(--space-sm)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  reasonError ? "border-status-danger-border" : "border-border"
                }`}
              />
              {reasonError && <p className="mt-[var(--space-xs)] text-caption font-medium text-status-danger-text">{reasonError}</p>}
            </div>
            <p className="text-caption text-content-secondary">The bill isn&apos;t deleted — it goes back to To pay marked as rejected, and the requester is told why.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
