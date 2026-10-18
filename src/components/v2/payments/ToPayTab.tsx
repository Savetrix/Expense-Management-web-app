"use client";

import { Check, FileCheck2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable, SearchInput } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { Bill, PayVendor } from "./types";
import { CARD_CLASS, TOOLBAR_CLASS, isOverdue, money, shortDate, sumAmounts } from "./shared";

interface ToPayTabProps {
  bills: Bill[];
  vendors: PayVendor[];
  onPaySelected: (bills: Bill[]) => void;
}

export function ToPayTab({ bills, vendors, onPaySelected }: ToPayTabProps) {
  const provider = useActiveProvider();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "Unknown vendor";

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return [...bills]
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      .filter((b) => !lower || vendorName(b.vendorId).toLowerCase().includes(lower) || b.reference.toLowerCase().includes(lower));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, search, vendors]);

  // Drop selections for bills that have since left this list.
  const selectedBills = bills.filter((b) => selected.has(b.id));
  const overdueCount = bills.filter(isOverdue).length;

  const toggle = (bill: Bill) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bill.id)) next.delete(bill.id);
      else next.add(bill.id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((b) => selected.has(b.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((b) => next.delete(b.id));
      else visible.forEach((b) => next.add(b.id));
      return next;
    });

  const columns: DataTableColumn<Bill>[] = [
    { key: "vendor", header: "Vendor", width: "32%", render: (b) => <span className="block truncate font-bold">{vendorName(b.vendorId)}</span> },
    { key: "ref", header: "Reference", width: "20%", render: (b) => <span className="block truncate text-content-secondary">{b.reference}</span> },
    {
      key: "due",
      header: "Due date",
      width: "28%",
      render: (b) => (
        <span className="flex flex-wrap items-center gap-[var(--space-xs)]">
          <span className={isOverdue(b) ? "font-semibold text-error" : ""}>{shortDate(b.dueDate)}</span>
          {isOverdue(b) && <Badge variant="error">Overdue</Badge>}
          {b.rejection && (
            <Badge variant="warning" title={`Rejected by ${b.rejection.by}: ${b.rejection.reason}`}>
              Rejected
            </Badge>
          )}
          {b.approved && <Badge variant="success">Approved</Badge>}
        </span>
      ),
    },
    { key: "amount", header: "Amount", width: "20%", align: "right", render: (b) => <span className="font-bold">{money(b.amount)}</span> },
  ];

  const pay = () => {
    onPaySelected(selectedBills);
    setSelected(new Set());
  };

  return (
    <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
      <div className={`${TOOLBAR_CLASS} lg:justify-between`}>
        <div className="flex flex-wrap items-center gap-[var(--space-sm)] text-body-sm text-content-secondary">
          <span>
            {bills.length === 0 ? "Unpaid bills" : `${bills.length} unpaid bill${bills.length === 1 ? "" : "s"} · ${money(sumAmounts(bills))}`}
          </span>
          {overdueCount > 0 && <Badge variant="error">{overdueCount} overdue</Badge>}
        </div>
        {bills.length > 0 && (
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor or reference…" widthClassName="w-full lg:w-80" />
        )}
      </div>

      {selectedBills.length > 0 && (
        <div className="m-[var(--space-md)] mb-0 flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-lg bg-accent-bg px-[var(--space-md)] py-[var(--space-sm)]">
          <div className="flex items-center gap-[var(--space-sm)]">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink">
              <Check size={14} strokeWidth={3} />
            </span>
            <span className="text-body-sm font-semibold text-accent-text-on-bg">
              {selectedBills.length} selected · {money(sumAmounts(selectedBills))}
            </span>
          </div>
          <div className="flex items-center gap-[var(--space-sm)]">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-pill px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-bold text-accent-text-on-bg hover:bg-surface/40"
            >
              Clear
            </button>
            <Button size="sm" onClick={pay}>
              Pay selected
            </Button>
          </div>
        </div>
      )}

      {bills.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 size={28} strokeWidth={1.75} />}
          title="No unpaid bills to show"
          description={`Unpaid bills load from ${provider.name} once the backend is connected (BE)`}
        />
      ) : visible.length === 0 ? (
        <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No bills match &quot;{search}&quot;.</div>
      ) : (
        <>
          <div className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] pt-[var(--space-md)]">
            <label className="flex items-center gap-[var(--space-xs)] text-caption font-semibold text-content-secondary">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="rounded border-border-strong text-accent focus:ring-accent" />
              Select all
            </label>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[620px]">
              <DataTable
                columns={columns}
                rows={visible}
                getRowKey={(b) => b.id}
                selectedKeys={selected}
                onToggleRow={toggle}
                onRowClick={toggle}
                bordered={false}
                maxHeightClassName="max-h-[560px]"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
