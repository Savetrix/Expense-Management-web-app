"use client";

import { Landmark } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable, RoleInfoBanner, SearchInput, SelectDropdown, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import { formatAmount } from "./format";
import { STATUS_LABEL } from "./TransactionModal";
import type { BankTransaction, BankTxnStatus } from "./types";

type StatusFilter = BankTxnStatus | "all";

interface TransactionsTabProps {
  txns: BankTransaction[];
  providerName: string;
  onImportFile: () => void;
  onConnect: () => void;
  onOpen: (id: string) => void;
  onBulkUpdate: (ids: string[], patch: Partial<BankTransaction>) => void;
}

const DATE_CLASS =
  "h-8 rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40";

export function TransactionsTab({ txns, providerName, onImportFile, onConnect, onOpen, onBulkUpdate }: TransactionsTabProps) {
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
    }),
    [txns],
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
            {beLabel("Connect a bank with Plaid")}
          </Button>
        </div>
      </div>
    );
  }

  const selectedIds = Array.from(selected).filter((id) => rows.some((r) => r.id === id));
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
        <Badge variant={t.status === "matched" ? "success" : t.status === "excluded" ? "neutral" : "warning"}>{STATUS_LABEL[t.status]}</Badge>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-col gap-[var(--space-sm)] border-b border-border bg-page p-[var(--space-md)]">
        <p className="text-caption text-content-secondary">
          {counts.total} total · {counts.review} to review · {counts.matched} matched · {counts.excluded} excluded
        </p>
        <div className="flex flex-col gap-[var(--space-sm)] lg:flex-row lg:flex-wrap lg:items-center">
          <Tabs
            items={[
              { value: "review", label: "To review", count: counts.review },
              { value: "matched", label: "Matched", count: counts.matched },
              { value: "excluded", label: "Excluded", count: counts.excluded },
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
        <RoleInfoBanner>
          Imported transactions live only in this session. Saving them needs the backend (BE), so they are lost when you leave or refresh the page.
        </RoleInfoBanner>
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
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
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
