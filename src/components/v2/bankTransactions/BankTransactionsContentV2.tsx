"use client";

import { FileUp, Landmark } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { PageHeader, Tabs } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { ConnectBankModal } from "./ConnectBankModal";
import { ConnectedAccountsTab } from "./ConnectedAccountsTab";
import { ImportFileModal } from "./ImportFileModal";
import { toCandidates } from "./matching";
import { TransactionModal } from "./TransactionModal";
import { TransactionsTab } from "./TransactionsTab";
import type { BankAccount, BankTransaction } from "./types";

type Tab = "transactions" | "accounts";

export function BankTransactionsContentV2() {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const { pendingInvoices, autoPostedInvoices, manualPostedInvoices, invoices, loading } = useAppSelector((s) => s.invoice);
  const glAccounts = useAppSelector((s) => s.quickBooks.accounts);

  const [tab, setTab] = useState<Tab>("transactions");
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Bills are only needed for matching; load them if nothing is cached yet.
  const noInvoices = pendingInvoices.length + autoPostedInvoices.length + manualPostedInvoices.length === 0 && invoices.length === 0;
  useEffect(() => {
    if (noInvoices && !loading) dispatch(getInvoices());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidates = useMemo(
    () => toCandidates(pendingInvoices, autoPostedInvoices, manualPostedInvoices),
    [pendingInvoices, autoPostedInvoices, manualPostedInvoices],
  );

  const patchMany = (ids: string[], patch: Partial<BankTransaction>) => {
    const set = new Set(ids);
    setTxns((prev) => prev.map((t) => (set.has(t.id) ? { ...t, ...patch } : t)));
  };
  const openTxn = txns.find((t) => t.id === openId) ?? null;

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Bank Transactions"
        subtitle="Import bank activity and match it to your bills."
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
              <Landmark size={16} strokeWidth={2.25} />
              Connect a bank
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <FileUp size={16} strokeWidth={2.25} />
              Import file
            </Button>
          </>
        }
      />

      <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border bg-page p-[var(--space-md)]">
          <Tabs
            items={[
              { value: "transactions", label: "Transactions", count: txns.length },
              { value: "accounts", label: "Connected accounts", count: bankAccounts.length },
            ]}
            value={tab}
            onChange={(v) => setTab(v as Tab)}
          />
        </div>

        {tab === "transactions" ? (
          <TransactionsTab
            txns={txns}
            providerName={provider.name}
            onImportFile={() => setImportOpen(true)}
            onConnect={() => setConnectOpen(true)}
            onOpen={setOpenId}
            onUpdate={(id, patch) => patchMany([id], patch)}
            invoices={candidates}
            onBulkUpdate={patchMany}
          />
        ) : (
          <ConnectedAccountsTab
            accounts={bankAccounts}
            glAccounts={glAccounts}
            providerName={provider.name}
            onConnect={() => setConnectOpen(true)}
            onChange={setBankAccounts}
          />
        )}
      </div>

      <ConnectBankModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      {importOpen && (
        <ImportFileModal
          open
          onClose={() => setImportOpen(false)}
          bankAccounts={bankAccounts}
          existing={txns}
          onImport={(added) => {
            setTxns((prev) => [...added, ...prev]);
            setTab("transactions");
          }}
        />
      )}
      {openTxn && (
        <TransactionModal
          key={openTxn.id}
          txn={openTxn}
          invoices={candidates}
          glAccounts={glAccounts}
          bankAccounts={bankAccounts}
          onClose={() => setOpenId(null)}
          onUpdate={(id, patch) => patchMany([id], patch)}
        />
      )}
    </div>
  );
}
