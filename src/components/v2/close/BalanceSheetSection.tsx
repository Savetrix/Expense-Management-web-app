"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { DataTable } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { BalanceSheetAccount, ChangeLogEntry } from "./mockData";
import { newId } from "./mockData";
import { AccountReconcileModal, type AccountDraft } from "./AccountReconcileModal";
import { accountIsReconciled, date, money, round2, supportTotal } from "./closeShared";
import type { CloseSectionProps } from "./sectionTypes";

const MANAGED_LABEL: Record<NonNullable<BalanceSheetAccount["managedBy"]>, string> = {
  prepayments: "Prepayments schedule",
  accruals: "Accruals schedule",
  fixed_assets: "Fixed asset register",
};

export function AccountStatusCell({ account }: { account: BalanceSheetAccount }) {
  if (account.managedBy) return <Badge variant="neutral" title={MANAGED_LABEL[account.managedBy]}>Managed by schedule</Badge>;
  if (account.dormant) return <Badge variant="neutral">Dormant · auto-reconciled</Badge>;
  if (account.reconciled) {
    return (
      <div className="flex min-w-0 flex-col items-start gap-[var(--space-xs)]">
        <Badge variant="success">Reconciled</Badge>
        <span className="block w-full truncate text-tiny text-content-secondary">
          by {account.reconciled.by}, {date(account.reconciled.at)}
        </span>
      </div>
    );
  }
  return <Badge variant="warning">To reconcile</Badge>;
}

/** Balance per schedule/support — managed and dormant accounts agree by definition. */
export const accountSupportBalance = (a: BalanceSheetAccount) => (a.managedBy || (a.dormant && a.lineItems.length === 0) ? a.ledgerBalance : supportTotal(a));

// Section 5 — every balance-sheet account explained by schedules, carried-
// forward line items or support added this period.
export function BalanceSheetSection({ paper, onUpdate, actor }: CloseSectionProps) {
  const provider = useActiveProvider();
  const [showDormant, setShowDormant] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = paper.accounts.filter((a) => showDormant || !a.dormant);
  const dormantCount = paper.accounts.filter((a) => a.dormant).length;
  const outstanding = paper.accounts.filter((a) => !accountIsReconciled(a)).length;
  const openAccount = paper.accounts.find((a) => a.id === openId) ?? null;

  const log = (message: string): ChangeLogEntry => ({ id: newId("log"), at: new Date().toISOString(), by: actor, message });

  const updateAccount = (accountId: string, change: (a: BalanceSheetAccount) => BalanceSheetAccount) =>
    onUpdate((wp) => ({ ...wp, accounts: wp.accounts.map((a) => (a.id === accountId ? change(a) : a)) }));

  const handleSave = (accountId: string, draft: AccountDraft) => {
    notifyBackendPending("Save reconciliation");
    updateAccount(accountId, (a) => ({ ...a, ...draft, changeLog: [...a.changeLog, log("Line items and support saved")] }));
    setOpenId(null);
  };

  const handleReconcile = (accountId: string, draft: AccountDraft, justification?: string) => {
    notifyBackendPending("Reconcile account");
    const reconciled = { by: actor, at: new Date().toISOString(), justification };
    updateAccount(accountId, (a) => ({
      ...a,
      ...draft,
      reconciled,
      changeLog: [...a.changeLog, log(justification ? `Reconciled with difference — ${justification}` : "Reconciled")],
    }));
    setOpenId(null);
    showToast("Account reconciled.", "success");
  };

  const handleUnreconcile = (accountId: string) => {
    notifyBackendPending("Undo reconciliation");
    updateAccount(accountId, (a) => ({ ...a, reconciled: undefined, changeLog: [...a.changeLog, log("Reconciliation undone")] }));
  };

  const columns: DataTableColumn<BalanceSheetAccount>[] = [
    { key: "code", header: "Code", width: "70px", render: (a) => <span className="font-mono font-semibold">{a.code}</span> },
    { key: "name", header: "Account", width: "22%", render: (a) => <span className="block truncate">{a.name}</span> },
    { key: "ledger", header: `Per ${provider.name}`, align: "right", render: (a) => money(a.ledgerBalance) },
    { key: "support", header: "Per schedule / support", align: "right", render: (a) => money(accountSupportBalance(a)) },
    {
      key: "difference",
      header: "Difference",
      align: "right",
      render: (a) => {
        const diff = round2(a.ledgerBalance - accountSupportBalance(a));
        return <span className={diff !== 0 ? "font-semibold text-status-danger-text" : ""}>{money(diff)}</span>;
      },
    },
    { key: "status", header: "Status", width: "22%", render: (a) => <AccountStatusCell account={a} /> },
  ];

  const canOpen = (a: BalanceSheetAccount) => !a.managedBy && !a.dormant;

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <div className="flex flex-col gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-content-secondary">
          {outstanding === 0 ? "Every balance-sheet account is reconciled." : `${outstanding} account${outstanding === 1 ? "" : "s"} still to reconcile. Select an account to add line items and support.`}
        </p>
        <label className="flex shrink-0 items-center gap-[var(--space-sm)] text-body-sm font-semibold text-content-primary">
          <Switch checked={showDormant} onChange={setShowDormant} label="Show dormant accounts" />
          Show dormant accounts ({dormantCount})
        </label>
      </div>

      <div className="hidden lg:block">
        <DataTable
          columns={columns}
          rows={visible}
          getRowKey={(a) => a.id}
          onRowClick={(a) => (canOpen(a) ? setOpenId(a.id) : undefined)}
        />
      </div>

      <div className="flex flex-col gap-[var(--space-sm)] lg:hidden">
        {visible.map((a) => {
          const diff = round2(a.ledgerBalance - accountSupportBalance(a));
          const body = (
            <>
              <div className="flex items-start justify-between gap-[var(--space-sm)]">
                <p className="min-w-0 truncate font-semibold text-content-primary">
                  <span className="font-mono">{a.code}</span> · {a.name}
                </p>
                <span className="text-body-sm font-bold text-content-primary">{money(a.ledgerBalance)}</span>
              </div>
              <div className="mt-[var(--space-sm)] flex items-center justify-between gap-[var(--space-sm)]">
                <AccountStatusCell account={a} />
                <span className={`text-caption ${diff !== 0 ? "font-semibold text-status-danger-text" : "text-content-secondary"}`}>Difference {money(diff)}</span>
              </div>
            </>
          );
          return canOpen(a) ? (
            <button key={a.id} type="button" onClick={() => setOpenId(a.id)} className="rounded-md border border-border bg-surface p-[var(--space-md)] text-left hover:shadow-sm">
              {body}
            </button>
          ) : (
            <div key={a.id} className="rounded-md border border-border bg-surface p-[var(--space-md)]">
              {body}
            </div>
          );
        })}
      </div>

      <AccountReconcileModal
        account={openAccount}
        onClose={() => setOpenId(null)}
        onSave={handleSave}
        onReconcile={handleReconcile}
        onUnreconcile={handleUnreconcile}
      />
    </div>
  );
}
