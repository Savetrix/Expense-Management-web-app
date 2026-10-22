"use client";

import { Landmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { DataTable, SearchInput, SelectDropdown, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog } from "@/lib/dialogManager";

import { formatAmount } from "./format";
import { findStrongSuggestions, paperworkHref } from "./matching";
import { SuggestedMatches } from "./SuggestedMatches";
import { STATUS_LABEL } from "./TransactionModal";
import type { BankTransaction, BankTxnStatus, InvoiceCandidate } from "./types";

type StatusFilter = BankTxnStatus | "all";

interface TransactionsTabProps {
  txns: BankTransaction[];
  providerName: string;
  onImportFile: () => void;
  onConnect: () => void;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BankTransaction>) => void;
  invoices: InvoiceCandidate[];
  onBulkUpdate: (ids: string[], patch: Partial<BankTransaction>) => void;
  /** Different changes for many lines in one request (accept all matches). */
  onBulkItems: (items: ({ id: string } & Partial<BankTransaction>)[]) => void;
  /** First load from the server still running. */
  loading?: boolean;
}

const DATE_CLASS =
  "h-8 rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40";

export function TransactionsTab({ txns, providerName, onImportFile, onConnect, onOpen, onUpdate, invoices, onBulkUpdate, onBulkItems, loading = false }: TransactionsTabProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusFilter>("review");
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const counts = useMemo(
    () => ({
      total: txns.length,
      review: txns.filter((t) => t.status === "review").length,
      matched: txns.filter((t) => t.status === "matched").length,
      excluded: txns.filter((t) => t.status === "excluded").length,
      transfer: txns.filter((t) => t.status === "transfer").length,
    }),
    [txns],
  );
  const suggestions = useMemo(
    () => findStrongSuggestions(txns, invoices).filter((s) => !dismissed.has(s.txn.id)),
    [txns, invoices, dismissed],
  );
  const accountNames = useMemo(() => Array.from(new Set(txns.map((t) => t.accountName).filter(Boolean))).sort(), [txns]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return txns
      .filter((t) => status === "all" || t.status === status)
      .filter((t) => !account || t.accountName === account)
      .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
      .filter((t) => !q || `${t.description} ${t.accountName} ${t.payee ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [txns, status, account, from, to, search]);

  if (txns.length === 0 && loading) {
    return (
      <div className="flex items-center justify-center gap-[var(--space-sm)] p-[var(--space-xl)] text-body-sm text-content-secondary">
        <Spinner size="sm" />
        Loading transactions…
      </div>
    );
  }

  if (txns.length === 0) {
    return (
      <div className="flex flex-col items-center pb-[var(--space-lg)]">
        <EmptyState
          icon={<Landmark size={28} strokeWidth={1.75} />}
          title="No transactions yet"
          description="Import a CSV file from your bank, or connect a bank with Plaid to bring in transactions."
        />
        <div className="flex flex-wrap justify-center gap-[var(--space-sm)]">
          <Button variant="outline" size="sm" onClick={onImportFile}>
            Import file
          </Button>
          <Button variant="outline" size="sm" onClick={onConnect}>
            Connect a bank with Plaid
          </Button>
        </div>
      </div>
    );
  }

  const acceptOne = (s: { txn: BankTransaction; invoice: InvoiceCandidate }) => {
    onUpdate(s.txn.id, { status: "matched", matchedInvoiceId: s.invoice.id });
  };
  const acceptAll = async () => {
    const ok = await confirmDialog({
      title: `Accept ${suggestions.length} strong match${suggestions.length === 1 ? "" : "es"}?`,
      message: "Each bank line is matched to the bill with the same amount dated within 7 days. You can still change a match afterwards.",
      confirmLabel: "Accept all",
    });
    if (!ok) return;
    onBulkItems(suggestions.map((s) => ({ id: s.txn.id, status: "matched" as const, matchedInvoiceId: s.invoice.id })));
  };

  const selectedIds = Array.from(selected).filter((id) => rows.some((r) => r.id === id));
  const paperworkTargets = rows.filter((r) => selectedIds.includes(r.id) && r.amount < 0 && r.status === "review" && !r.matchedInvoiceId);
  const askForPaperwork = async () => {
    const first = paperworkTargets[0];
    if (!first) return;
    const ok = await confirmDialog({
      title: `Ask for paperwork for ${paperworkTargets.length} selected?`,
      message:
        paperworkTargets.length === 1
          ? "This opens the request form filled in from this bank line."
          : `The request form takes one item at a time, so it opens for the first one ("${first.description}"). Come back for the others afterwards.`,
      confirmLabel: "Open request form",
    });
    if (ok) router.push(paperworkHref(first));
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: DataTableColumn<BankTransaction>[] = [
    { key: "date", header: "Date", width: "110px", render: (t) => <span className="whitespace-nowrap">{t.date}</span> },
    {
      key: "description",
      header: "Description",
      width: "34%",
      render: (t) => <span className="block truncate font-semibold">{t.description || "—"}</span>,
    },
    { key: "account", header: "Account", width: "20%", render: (t) => <span className="block truncate text-content-secondary">{t.accountName || "—"}</span> },
    {
      key: "amount",
      header: "Amount",
      width: "120px",
      align: "right",
      render: (t) => <span className={`font-semibold ${t.amount < 0 ? "text-status-danger-text" : ""}`}>{formatAmount(t.amount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "110px",
      render: (t) => (
        <Badge variant={t.status === "matched" ? "success" : t.status === "excluded" || t.status === "transfer" ? "neutral" : "warning"}>{STATUS_LABEL[t.status]}</Badge>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-col gap-[var(--space-sm)] border-b border-border bg-page p-[var(--space-md)]">
        <p className="text-caption text-content-secondary">
          {counts.total} total · {counts.review} to review · {counts.matched} matched · {counts.excluded} excluded · {counts.transfer} transfer
        </p>
        <div className="flex flex-col gap-[var(--space-sm)] lg:flex-row lg:flex-wrap lg:items-center">
          <Tabs
            items={[
              { value: "review", label: "To review", count: counts.review },
              { value: "matched", label: "Matched", count: counts.matched },
              { value: "excluded", label: "Excluded", count: counts.excluded },
              { value: "transfer", label: "Transfers", count: counts.transfer },
              { value: "all", label: "All", count: counts.total },
            ]}
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
          />
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transactions…" widthClassName="w-full lg:w-72" />
          <SelectDropdown uiSize="sm" aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accountNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectDropdown>
          <div className="flex items-center gap-[var(--space-xs)]">
            <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
            <span className="text-caption text-content-secondary">to</span>
            <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
          </div>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-[var(--space-sm)] border-b border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]">
          <span className="text-body-sm font-semibold text-content-primary">{selectedIds.length} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onBulkUpdate(selectedIds, { status: "excluded", matchedInvoiceId: undefined });
              setSelected(new Set());
            }}
          >
            Exclude selected
          </Button>
          <Button
            size="sm"
            onClick={() => {
              notifyBackendPending(`Import selected to ${providerName}`);
              onBulkUpdate(selectedIds, { status: "matched" });
              setSelected(new Set());
            }}
          >
            {beLabel(`Import selected to ${providerName}`)}
          </Button>
          {paperworkTargets.length > 0 && (
            <Button size="sm" variant="outline" onClick={askForPaperwork}>
              Ask for paperwork for {paperworkTargets.length} selected
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {status === "review" && (
        <SuggestedMatches
          suggestions={suggestions}
          onAccept={acceptOne}
          onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))}
          onAcceptAll={acceptAll}
        />
      )}

      {rows.length === 0 ? (
        <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No transactions match these filters.</div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(t) => t.id}
          bordered={false}
          maxHeightClassName="max-h-[560px]"
          selectedKeys={selected}
          onToggleRow={(t) => toggle(t.id)}
          onRowClick={(t) => onOpen(t.id)}
        />
      )}
    </div>
  );
}
