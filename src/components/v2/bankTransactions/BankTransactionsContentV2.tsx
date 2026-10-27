"use client";

import { AlertTriangle, FileUp, Landmark } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { PageHeader, Tabs } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { showToast } from "@/lib/dialogManager";
import {
  bulkUpdateBankTransactions,
  fetchBankAccounts,
  fetchBankTransactions,
  importBankCsv,
  updateBankTransaction,
  type BankTxnPatch,
} from "@/store/bankFeeds/bankFeedsApi";
import { getInvoices } from "@/store/invoice/invoiceApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { useBankLookups } from "./coding";
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
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  // Mirrors the server's role rules (lib/bankFeeds/door.ts): owners and admins
  // connect banks; accountants code and post; contributors have no bank access.
  const connections = useAppSelector((s) => s.quickBooks.connections);
  const active = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const role = active?.role?.toLowerCase();
  const canConnect = role !== "accountant" && role !== "contributor";
  const noAccess = role === "contributor";
  const bank = useAppSelector((s) => s.bankFeeds);
  const bankAccounts: BankAccount[] = bank.qbConnectionId === qbConnectionId ? bank.accounts : [];
  const txns: BankTransaction[] = bank.transactionsConnectionId === qbConnectionId ? bank.transactions : [];
  const [connectOpen, setConnectOpen] = useState(false);
  const [relogin, setRelogin] = useState<BankAccount | null>(null);
  const lookups = useBankLookups();
  // After a decision the server re-scores lines with the same payee in the
  // background; reload shortly after so lines Scantrix just coded show it.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchSoon = () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => dispatch(fetchBankTransactions()), 1500);
  };
  const [importOpen, setImportOpen] = useState(false);
  // "/bank-transactions?open=<id>" (from an invoice's "Matching bank transaction
  // found") opens that line once it has loaded.
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("open"),
  );

  // Bills are only needed for matching; load them if nothing is cached yet.
  const noInvoices = pendingInvoices.length + autoPostedInvoices.length + manualPostedInvoices.length === 0 && invoices.length === 0;
  useEffect(() => {
    if (noInvoices && !loading) dispatch(getInvoices());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bank accounts belong to the company picked in the header: reload on switch.
  useEffect(() => {
    if (!qbConnectionId) return;
    dispatch(fetchBankAccounts());
    dispatch(fetchBankTransactions());
  }, [dispatch, qbConnectionId]);

  // New lines arrive through Plaid's webhook while the page is open; check
  // every 30 seconds (only while the tab is visible) and on coming back to the
  // tab, so they appear without a reload.
  useEffect(() => {
    if (!qbConnectionId) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      dispatch(fetchBankAccounts());
      dispatch(fetchBankTransactions());
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [dispatch, qbConnectionId]);

  const candidates = useMemo(
    () => toCandidates(pendingInvoices, autoPostedInvoices, manualPostedInvoices),
    [pendingInvoices, autoPostedInvoices, manualPostedInvoices],
  );

  // Every decision is saved on the server. A status change carries the line's
  // version, so a teammate's newer change is never overwritten; field edits
  // (GL, payee) are last-write-wins so quick successive edits never collide.
  const patchOne = async (id: string, patch: Partial<BankTransaction>) => {
    const row = txns.find((t) => t.id === id);
    const result = await dispatch(updateBankTransaction({ id, patch: patch as BankTxnPatch, version: "status" in patch ? row?.version : undefined }));
    if (updateBankTransaction.rejected.match(result)) showToast(result.payload?.message ?? "Couldn't save that change.", "error");
    else refetchSoon();
  };
  const patchMany = async (ids: string[], patch: Partial<BankTransaction>) => {
    if (ids.length === 1) return patchOne(ids[0], patch);
    const result = await dispatch(bulkUpdateBankTransactions({ ids, patch: patch as BankTxnPatch }));
    if (bulkUpdateBankTransactions.fulfilled.match(result)) {
      const { updated, failed } = result.payload;
      if (failed.length > 0) showToast(`${updated.length} saved, ${failed.length} not: ${failed[0].error}`, "warning");
      refetchSoon();
    } else showToast(result.payload?.message ?? "Couldn't save those changes.", "error");
  };
  const [openFocus, setOpenFocus] = useState<"match" | "transfer" | undefined>(undefined);
  const openTxn = txns.find((t) => t.id === openId) ?? null;

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Bank Transactions"
        subtitle="Import bank activity and match it to your bills."
        action={
          noAccess ? undefined : (
            <>
              {canConnect && (
                <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
                  <Landmark size={16} strokeWidth={2.25} />
                  Connect a bank
                </Button>
              )}
              <Button size="sm" onClick={() => setImportOpen(true)}>
                <FileUp size={16} strokeWidth={2.25} />
                Import file
              </Button>
            </>
          )
        }
      />

      {noAccess && (
        <div role="alert" className="mt-[var(--space-lg)] rounded-md border border-border bg-surface p-[var(--space-lg)] text-body-sm text-content-secondary">
          Bank transactions are for owners, admins and accountants of {active?.name ?? "this company"}. Ask an owner to change your role if you need them.
        </div>
      )}

      {bankAccounts
        // One warning per bank login, which may hold several accounts.
        .filter((a, i, all) => a.status === "needs_relogin" && all.findIndex((x) => x.itemId === a.itemId) === i)
        .map((a) => (
          <div
            key={a.id}
            role="alert"
            className="mt-[var(--space-md)] flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-md border border-status-warning-border bg-status-warning-bg px-[var(--space-md)] py-[var(--space-sm)]"
          >
            <p className="flex min-w-0 items-start gap-[var(--space-xs)] text-body-sm text-status-warning-text">
              <AlertTriangle size={16} strokeWidth={2.25} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-semibold">
                  {a.institutionName} {a.name}
                  {a.mask ? ` ••${a.mask}` : ""}:
                </span>{" "}
                {a.statusDetail ?? "The bank login changed or expired."} New transactions stop until then.
              </span>
            </p>
            {canConnect ? (
              <Button size="sm" onClick={() => setRelogin(a)}>
                Sign in again
              </Button>
            ) : (
              <span className="text-caption font-semibold text-status-warning-text">Ask an owner or admin to sign in again.</span>
            )}
          </div>
        ))}

      {!noAccess && (
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
            onConnect={canConnect ? () => setConnectOpen(true) : undefined}
            onOpen={(id, focus) => {
              setOpenFocus(focus);
              setOpenId(id);
            }}
            onUpdate={patchOne}
            invoices={candidates}
            onBulkUpdate={patchMany}
            onBulkItems={async (items) => {
              const result = await dispatch(bulkUpdateBankTransactions({ items: items as ({ id: string } & BankTxnPatch)[] }));
              if (bulkUpdateBankTransactions.fulfilled.match(result)) {
                const { updated, failed } = result.payload;
                showToast(failed.length ? `${updated.length} matched, ${failed.length} not: ${failed[0].error}` : `${updated.length} matched.`, failed.length ? "warning" : "success");
              } else showToast(result.payload?.message ?? "Couldn't save those matches.", "error");
            }}
            lookups={lookups}
            loading={!bank.transactionsLoaded && bank.transactionsLoading}
          />
        ) : (
          <ConnectedAccountsTab
            accounts={bankAccounts}
            glAccounts={glAccounts}
            providerName={provider.name}
            onConnect={() => setConnectOpen(true)}
            canConnect={canConnect}
            onRelogin={setRelogin}
            busyAccountId={bank.busyAccountId}
            onSynced={() => dispatch(fetchBankTransactions())}
          />
        )}
        </div>
      )}

      {bank.unavailableReason && (
        <p className="mt-[var(--space-sm)] text-caption text-content-secondary">
          {bank.unavailableReason === "disabled" ? "Bank feeds are switched off on this server." : "Bank feeds are not set up on this server yet, so banks can't be connected."}
        </p>
      )}

      <ConnectBankModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={() => setTab("accounts")} />
      {relogin && (
        <ConnectBankModal
          open
          onClose={() => setRelogin(null)}
          reloginAccountId={relogin.id}
          reloginLabel={`${relogin.institutionName} ${relogin.name}`}
        />
      )}
      {importOpen && (
        <ImportFileModal
          open
          onClose={() => setImportOpen(false)}
          bankAccounts={bankAccounts}
          existing={txns}
          onImport={async (added) => {
            const result = await dispatch(
              importBankCsv({ accountName: added[0]?.accountName ?? "Imported file", rows: added.map((t) => ({ date: t.date, description: t.description, amount: t.amount })) }),
            );
            if (importBankCsv.fulfilled.match(result)) {
              const { added: n, duplicates } = result.payload;
              showToast(`${n} transaction${n === 1 ? "" : "s"} imported${duplicates ? `, ${duplicates} already here` : ""}.`, "success");
              setTab("transactions");
              return true;
            }
            showToast(result.payload?.message ?? "Couldn't save the imported rows.", "error");
            return false;
          }}
        />
      )}
      {openTxn && (
        <TransactionModal
          key={`${openTxn.id}-${openFocus ?? "details"}`}
          txn={openTxn}
          invoices={candidates}
          lookups={lookups}
          bankAccounts={bankAccounts}
          initialFocus={openFocus}
          providerName={provider.name}
          onClose={() => setOpenId(null)}
          onUpdate={patchOne}
        />
      )}
    </div>
  );
}
