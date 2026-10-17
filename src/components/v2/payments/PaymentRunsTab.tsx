"use client";

import { AlertTriangle, History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable, Modal, ModalDefinitionRow, SelectDropdown } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { PayingAccount, PaymentRun, RunStatus } from "./mockData";
import { CARD_CLASS, RUN_STATUS_META, TOOLBAR_CLASS, delay, maskNumber, money, shortDate } from "./shared";

interface PaymentRunsTabProps {
  runs: PaymentRun[];
  accounts: PayingAccount[];
  onChangeRun: (id: string, patch: Partial<PaymentRun>) => void;
}

type Filter = "all" | RunStatus;

export function PaymentRunsTab({ runs, accounts, onChangeRun }: PaymentRunsTabProps) {
  const provider = useActiveProvider();
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountLabel = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.name} ${maskNumber(a.mask)}` : "—";
  };

  const visible = useMemo(
    () => [...runs].sort((a, b) => (a.date < b.date ? 1 : -1)).filter((r) => filter === "all" || r.status === filter),
    [runs, filter],
  );
  const open = runs.find((r) => r.id === openId) ?? null;
  const vendorCount = (run: PaymentRun) => new Set(run.bills.map((b) => b.vendorName)).size;

  const handleRetry = async (run: PaymentRun) => {
    setBusy(true);
    await delay(600);
    onChangeRun(run.id, { status: "processing", failureReason: undefined });
    setBusy(false);
    notifyBackendPending("Retry payment");
    showToast("Payment resubmitted to the bank.", "success");
  };

  const handleResend = async (run: PaymentRun) => {
    setBusy(true);
    await delay();
    setBusy(false);
    notifyBackendPending("Resend authorisation request");
    showToast(`Authorisation request for ${money(run.total)} sent again.`, "success");
  };

  const columns: DataTableColumn<PaymentRun>[] = [
    { key: "date", header: "Run date", width: "18%", render: (r) => shortDate(r.date) },
    {
      key: "bills",
      header: "Bills",
      width: "16%",
      render: (r) => (
        <span className="block truncate text-content-secondary">
          {r.bills.length} bill{r.bills.length === 1 ? "" : "s"}
        </span>
      ),
    },
    { key: "from", header: "Paid from", width: "26%", render: (r) => <span className="block truncate text-content-secondary">{accountLabel(r.paidFromId)}</span> },
    { key: "total", header: "Total", width: "16%", align: "right", render: (r) => <span className="font-bold">{money(r.total)}</span> },
    {
      key: "status",
      header: "Status",
      width: "24%",
      align: "right",
      render: (r) => <Badge variant={RUN_STATUS_META[r.status].variant}>{RUN_STATUS_META[r.status].label}</Badge>,
    },
  ];

  return (
    <>
      <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
        <div className={`${TOOLBAR_CLASS} lg:justify-between`}>
          <p className="text-body-sm text-content-secondary">Every batch of payments you&apos;ve sent, newest first.</p>
          {runs.length > 0 && (
            <SelectDropdown uiSize="sm" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {(Object.keys(RUN_STATUS_META) as RunStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RUN_STATUS_META[s].label}
                </option>
              ))}
            </SelectDropdown>
          )}
        </div>

        {runs.length === 0 ? (
          <EmptyState
            icon={<History size={28} strokeWidth={1.75} />}
            title="No payment runs yet"
            description="Select bills under To pay and pay them together — each run is tracked here until the bank confirms it."
          />
        ) : visible.length === 0 ? (
          <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No runs with this status.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <DataTable columns={columns} rows={visible} getRowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} bordered={false} maxHeightClassName="max-h-[560px]" />
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!open}
        onClose={() => !busy && setOpenId(null)}
        title={open ? `Payment run · ${shortDate(open.date)}` : ""}
        widthClassName="max-w-lg"
        footer={
          open ? (
            open.status === "failed" ? (
              <Button size="sm" onClick={() => handleRetry(open)} loading={busy} disabled={busy}>
                <RotateCcw size={16} strokeWidth={2.25} />
                {beLabel("Retry payment")}
              </Button>
            ) : open.status === "waiting_authorisation" ? (
              <Button variant="outline" size="sm" onClick={() => handleResend(open)} loading={busy} disabled={busy}>
                {beLabel("Resend authorisation request")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setOpenId(null)}>
                Close
              </Button>
            )
          ) : undefined
        }
      >
        {open && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Status">
                <Badge variant={RUN_STATUS_META[open.status].variant}>{RUN_STATUS_META[open.status].label}</Badge>
              </ModalDefinitionRow>
              <ModalDefinitionRow label="Paid from">{accountLabel(open.paidFromId)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Payments">{vendorCount(open)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Total">{money(open.total)}</ModalDefinitionRow>
            </div>

            {open.status === "failed" && (
              <div className="rounded-md border border-status-danger-border bg-status-danger-bg p-[var(--space-sm)] text-body-sm text-status-danger-text">
                <p className="flex items-center gap-[var(--space-xs)] font-semibold">
                  <AlertTriangle size={16} strokeWidth={2.25} />
                  Payment failed
                </p>
                <p className="mt-[var(--space-xs)]">{open.failureReason}</p>
                <p className="mt-[var(--space-xs)]">
                  The bill payment recorded in {provider.name} has been reversed, so the bills show as unpaid again until a retry goes through.
                </p>
              </div>
            )}
            {open.status === "waiting_authorisation" && (
              <p className="text-body-sm text-content-secondary">Waiting for the bank login holder to authorise this run in their banking app.</p>
            )}
            {open.status === "processing" && (
              <p className="text-body-sm text-content-secondary">
                The bank is processing these payments. Each is recorded as a bill payment in {provider.name} once the bank confirms.
              </p>
            )}

            <div>
              <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">Bills</p>
              <div className="mt-[var(--space-sm)] flex flex-col divide-y divide-border rounded-md border border-border">
                {open.bills.map((b) => (
                  <div key={b.billId} className="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">{b.vendorName}</span>
                      <span className="block text-caption text-content-secondary">{b.reference}</span>
                    </span>
                    <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(b.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
