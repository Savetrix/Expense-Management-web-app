"use client";

import { KeyRound, Landmark, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { SelectDropdown } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { disconnectBankAccount, saveBankMapping, syncBankAccount } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch } from "@/store/hooks";
import type { GLAccount } from "@/store/quickBooks/quickBooksSlice";

import { FIELD_LABEL_CLASS, formatAmount, formatDateTime } from "./format";
import type { BankAccount } from "./types";

interface ConnectedAccountsTabProps {
  accounts: BankAccount[];
  glAccounts: GLAccount[];
  providerName: string;
  onConnect: () => void;
  /** Opens Plaid in update mode for this account's bank login. */
  onRelogin: (account: BankAccount) => void;
  /** Account whose row is busy, from the store. */
  busyAccountId: string | null;
  /** Called after a sync brought new lines, so the transactions list reloads. */
  onSynced?: () => void;
}

export function ConnectedAccountsTab({ accounts, glAccounts, providerName, onConnect, onRelogin, busyAccountId, onSynced }: ConnectedAccountsTabProps) {
  const dispatch = useAppDispatch();
  // Bank-type GL accounts when the software labels any; otherwise every account.
  const glOptions = useMemo(() => {
    const live = glAccounts.filter((a) => !a.isDeleted);
    const banks = live.filter((a) => a.accountType?.toLowerCase().includes("bank"));
    return banks.length > 0 ? banks : live;
  }, [glAccounts]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Landmark size={28} strokeWidth={1.75} />}
        title="No bank connected"
        description="Connect a bank with Plaid to bring in transactions automatically, or import a CSV file instead."
        actionLabel="Connect a bank with Plaid"
        onAction={onConnect}
      />
    );
  }

  const disconnect = async (acct: BankAccount) => {
    const ok = await confirmDialog({
      title: "Disconnect this account?",
      message: `${acct.institutionName} ${acct.name} will stop syncing. Imported transactions stay in Scantrix.`,
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!ok) return;
    const result = await dispatch(disconnectBankAccount(acct.id));
    if (disconnectBankAccount.fulfilled.match(result)) showToast(`${acct.institutionName} ${acct.name} disconnected.`, "success");
    else showToast(result.payload?.message ?? "Couldn't disconnect. Please try again.", "error");
  };

  const syncNow = async (acct: BankAccount) => {
    const result = await dispatch(syncBankAccount(acct.id));
    if (!syncBankAccount.fulfilled.match(result)) {
      showToast(result.payload?.message ?? "Couldn't sync. Please try again.", "error");
      return;
    }
    const o = result.payload.outcome;
    if (o.status === "synced") {
      const n = o.added + o.modified;
      showToast(n > 0 ? `${n} transaction${n === 1 ? "" : "s"} brought in.` : "Up to date. Plaid had nothing new.", "success");
      if (n + o.removed > 0) onSynced?.();
    } else if (o.status === "busy") showToast("A sync is already running for this bank.", "info");
    else if (o.status === "login_required") showToast("The bank needs you to sign in again.", "warning");
    else showToast("Plaid couldn't sync this bank just now. Try again later.", "error");
  };

  const saveMapping = async (acct: BankAccount, ledgerId: string) => {
    const ledger = glOptions.find((g) => g._id === ledgerId);
    const result = await dispatch(saveBankMapping({ accountId: acct.id, ledgerAccountId: ledgerId, ledgerAccountName: ledger?.name ?? ledgerId }));
    if (saveBankMapping.fulfilled.match(result)) showToast("Mapping saved.", "success");
    else showToast(result.payload?.message ?? "Couldn't save the mapping.", "error");
  };

  return (
    <ul className="divide-y divide-border">
      {accounts.map((acct) => {
        const selected = drafts[acct.id] ?? acct.mappedGlAccountId ?? "";
        const busy = busyAccountId === acct.id;
        return (
          <li key={acct.id} className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)]">
            <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
              <div className="min-w-0">
                <p className="truncate text-body font-bold text-content-primary">{acct.institutionName}</p>
                <p className="truncate text-body-sm text-content-secondary">
                  {acct.name}
                  {acct.mask ? ` ····${acct.mask}` : ""}
                </p>
                <p className="text-caption text-content-muted">
                  Last synced: {formatDateTime(acct.lastSyncedAt)}
                  {typeof acct.currentBalance === "number" && ` · Balance ${formatAmount(acct.currentBalance)}${acct.currency ? ` ${acct.currency}` : ""}`}
                </p>
                {acct.historyLoading && acct.status !== "needs_relogin" && (
                  <p className="text-caption text-content-muted">Plaid is still bringing in older transactions. They appear as they arrive.</p>
                )}
              </div>
              <Badge variant={acct.status === "needs_relogin" ? "warning" : "success"}>
                {acct.status === "needs_relogin" ? "Needs re-login" : acct.status === "syncing" ? "Syncing" : "Connected"}
              </Badge>
            </div>

            {acct.status === "needs_relogin" && (
              <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-md border border-status-warning-border bg-status-warning-bg px-[var(--space-md)] py-[var(--space-sm)]">
                <p className="text-body-sm text-status-warning-text">{acct.statusDetail ?? "The bank login changed or expired. Sign in again to resume syncing."}</p>
                <Button size="sm" onClick={() => onRelogin(acct)}>
                  <KeyRound size={14} strokeWidth={2.25} />
                  Sign in again
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-[var(--space-sm)] sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label className={FIELD_LABEL_CLASS} htmlFor={`map-${acct.id}`}>
                  Post to bank account in {providerName}
                </label>
                <SelectDropdown
                  id={`map-${acct.id}`}
                  value={selected}
                  onChange={(e) => setDrafts((d) => ({ ...d, [acct.id]: e.target.value }))}
                  className="mt-[var(--space-xs)] w-full"
                >
                  <option value="">Select an account</option>
                  {glOptions.map((g) => (
                    <option key={g._id} value={g._id}>
                      {g.name}
                    </option>
                  ))}
                </SelectDropdown>
              </div>
              <Button variant="outline" disabled={!selected || busy || selected === acct.mappedGlAccountId} onClick={() => saveMapping(acct, selected)}>
                Save mapping
              </Button>
            </div>

            <div className="flex flex-wrap gap-[var(--space-sm)]">
              <Button variant="outline" size="sm" disabled={busy || acct.status === "needs_relogin"} onClick={() => syncNow(acct)}>
                {busy ? <Spinner size="sm" /> : <RefreshCw size={14} strokeWidth={2.25} />}
                Sync now
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => disconnect(acct)}>
                <Trash2 size={14} strokeWidth={2.25} />
                Disconnect
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
