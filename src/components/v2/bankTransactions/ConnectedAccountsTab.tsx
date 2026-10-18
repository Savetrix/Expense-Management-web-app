"use client";

import { Landmark, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectDropdown } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog } from "@/lib/dialogManager";
import type { GLAccount } from "@/store/quickBooks/quickBooksSlice";

import { FIELD_LABEL_CLASS, formatDateTime } from "./format";
import type { BankAccount } from "./types";

interface ConnectedAccountsTabProps {
  accounts: BankAccount[];
  glAccounts: GLAccount[];
  providerName: string;
  onConnect: () => void;
  onChange: (next: BankAccount[]) => void;
}

export function ConnectedAccountsTab({ accounts, glAccounts, providerName, onConnect, onChange }: ConnectedAccountsTabProps) {
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
        actionLabel={beLabel("Connect a bank with Plaid")}
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
    notifyBackendPending("Disconnect account");
    onChange(accounts.filter((a) => a.id !== acct.id));
  };

  return (
    <ul className="divide-y divide-border">
      {accounts.map((acct) => {
        const selected = drafts[acct.id] ?? acct.mappedGlAccountId ?? "";
        return (
          <li key={acct.id} className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)]">
            <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
              <div className="min-w-0">
                <p className="truncate text-body font-bold text-content-primary">{acct.institutionName}</p>
                <p className="truncate text-body-sm text-content-secondary">
                  {acct.name}
                  {acct.mask ? ` ····${acct.mask}` : ""}
                </p>
                <p className="text-caption text-content-muted">Last synced: {formatDateTime(acct.lastSyncedAt)}</p>
              </div>
              <Badge variant={acct.status === "connected" ? "success" : "warning"}>
                {acct.status === "connected" ? "Connected" : "Needs re-login"}
              </Badge>
            </div>

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
              <Button
                variant="outline"
                disabled={!selected}
                onClick={() => {
                  notifyBackendPending("Save mapping");
                  onChange(accounts.map((a) => (a.id === acct.id ? { ...a, mappedGlAccountId: selected } : a)));
                }}
              >
                {beLabel("Save mapping")}
              </Button>
            </div>

            <div className="flex flex-wrap gap-[var(--space-sm)]">
              <Button variant="outline" size="sm" onClick={() => notifyBackendPending("Sync now")}>
                <RefreshCw size={14} strokeWidth={2.25} />
                {beLabel("Sync now")}
              </Button>
              <Button variant="danger" size="sm" onClick={() => disconnect(acct)}>
                <Trash2 size={14} strokeWidth={2.25} />
                {beLabel("Disconnect")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
