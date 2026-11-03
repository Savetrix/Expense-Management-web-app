"use client";

import { Car, ExternalLink, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { DataTable, Modal, ModalDefinitionRow, SearchInput, SelectDropdown, Tabs, TextInput } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  approveJourney,
  createJourney,
  deleteJourney,
  markJourneyPaid,
  payJourney,
  rejectJourney,
  type ExpenseSettingsDto,
  type JourneyDto,
  type JourneyStatus,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { PayEmployeeModal } from "./PayEmployeeModal";
import {
  CARD_CLASS,
  CLAIM_STATUS_META,
  TOOLBAR_CLASS,
  approverOptionsFor,
  canEditSettings,
  effectiveApprover,
  errorMessage,
  isApprover,
  money,
  shortDate,
  todayIso,
  type CompanyRole,
} from "./shared";
import type { TeamPerson } from "./useTeamMembers";

interface MileageTabProps {
  journeys: JourneyDto[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  drivers: TeamPerson[];
  driversLoading: boolean;
  settings: ExpenseSettingsDto | null;
  role: CompanyRole;
  selfId: string;
  onOpenSettings: () => void;
}

interface TripForm {
  driverId: string;
  date: string;
  km: string;
  purpose: string;
  approverId: string;
}

const STATUS_ORDER: JourneyStatus[] = ["awaiting_review", "awaiting_reimbursement", "paid", "rejected"];
// A trip waits for approval; the rest reads like a claim.
const statusLabel = (s: JourneyStatus) => (s === "awaiting_review" ? "Awaiting approval" : CLAIM_STATUS_META[s].label);
type View = JourneyStatus | "assigned";
type Busy = "approve" | "approvePay" | "reject" | "markPaid" | "delete";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function MileageTab({ journeys, loading, error, onRetry, drivers, driversLoading, settings, role, selfId, onOpenSettings }: MileageTabProps) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const approver = isApprover(role);
  const rate = settings?.mileageRate ?? null;
  const allowSelfApproval = settings?.allowSelfApproval ?? false;
  // Submitters (contributors) log only their own trips.
  const driverOptions = useMemo(() => (approver ? drivers : drivers.filter((d) => d.userId === selfId)), [approver, drivers, selfId]);

  const [view, setView] = useState<View>(approver ? "assigned" : "awaiting_review");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<TripForm | null>(null);
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);

  // The approver it was sent to acts on it, or an owner/admin as backup.
  const canAct = (j: JourneyDto) => approver && (!j.approver || j.approver.userId === selfId || role === "owner" || role === "admin");
  const isOwn = (j: JourneyDto) => j.createdBy === selfId || j.driver.userId === selfId;
  const selfBlocked = (j: JourneyDto) => isOwn(j) && !allowSelfApproval;
  const canDelete = (j: JourneyDto) => (j.status === "awaiting_review" || j.status === "rejected") && (j.createdBy === selfId || canAct(j));

  const counts = useMemo(() => {
    const c: Record<View, number> = { assigned: 0, awaiting_review: 0, awaiting_reimbursement: 0, paid: 0, rejected: 0 };
    journeys.forEach((j) => {
      c[j.status] += 1;
      if (j.status === "awaiting_review" && j.approver?.userId === selfId) c.assigned += 1;
    });
    return c;
  }, [journeys, selfId]);

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return journeys
      .filter((j) => (view === "assigned" ? j.status === "awaiting_review" && j.approver?.userId === selfId : j.status === view))
      .filter((j) => !lower || [j.driver.name, j.purpose].some((v) => v.toLowerCase().includes(lower)));
  }, [journeys, view, search, selfId]);

  const detail = journeys.find((j) => j.id === detailId) ?? null;
  const paying = journeys.find((j) => j.id === payId);

  const km = form && form.km.trim() !== "" && Number(form.km) > 0 ? round2(Number(form.km)) : null;
  const formAmount = km === null || rate === null ? null : round2(km * rate);
  const approverOptions = useMemo(
    () => approverOptionsFor(drivers, { selfId, subjectUserId: form?.driverId ?? "", allowSelfApproval }),
    [drivers, selfId, form?.driverId, allowSelfApproval],
  );
  const formApproverId = effectiveApprover(approverOptions, form?.approverId ?? "");

  const openForm = () => {
    // Most trips are your own; an approver logging one for someone else picks them.
    const self = driverOptions.find((d) => d.userId === selfId);
    setForm({ driverId: self?.userId ?? driverOptions[0]?.userId ?? "", date: todayIso(), km: "", purpose: "", approverId: "" });
    setFormError("");
  };

  const closeForm = () => {
    if (!creating) setForm(null);
  };

  const patch = (p: Partial<TripForm>) => setForm((f) => (f ? { ...f, ...p } : f));

  const handleCreate = async () => {
    if (!form) return;
    if (!form.driverId) return setFormError("Choose who made the trip.");
    if (!form.date) return setFormError("Pick the trip date.");
    if (km === null) return setFormError("Enter the trip's total km.");
    if (!form.purpose.trim()) return setFormError("Add the purpose of the trip.");
    if (!formApproverId) return setFormError("Choose who should approve it.");
    setFormError("");
    setCreating(true);
    const result = await dispatch(
      createJourney({ driver: { userId: form.driverId }, date: form.date, km, purpose: form.purpose.trim(), approverId: formApproverId }),
    );
    setCreating(false);
    if (createJourney.fulfilled.match(result)) {
      setForm(null);
      setView(approver && result.payload.approver?.userId === selfId ? "assigned" : "awaiting_review");
      showToast(`Trip sent to ${result.payload.approver?.name ?? "your approver"} — ${money(result.payload.amount)}.`, "success");
    } else {
      setFormError(errorMessage(result.payload, "Couldn't save the trip."));
    }
  };

  const run = async (key: Busy, action: () => Promise<{ ok: boolean; payload: unknown }>, success: string, fallback: string) => {
    setBusy(key);
    const { ok, payload } = await action();
    setBusy(null);
    if (ok) showToast(success, "success");
    else showToast(errorMessage(payload, fallback), "error");
    return { ok, payload };
  };

  const handleApprove = async (j: JourneyDto, pay: boolean) => {
    const ok = await confirmDialog({
      title: pay ? "Approve, post and mark as paid?" : `Approve and post to ${provider.name}?`,
      message: `This creates a bill in ${provider.name} payable to ${j.driver.name} for ${money(j.amount)} (${j.km} km × ${money(j.rate)}).${
        pay ? ` It also records that they've been paid — Scantrix doesn't send the money.` : ""
      }`,
      confirmLabel: pay ? "Approve & mark paid" : "Approve & post",
    });
    if (!ok) return;
    const { ok: done, payload } = await run(
      pay ? "approvePay" : "approve",
      async () => {
        const r = await dispatch(approveJourney({ id: j.id, pay }));
        return { ok: approveJourney.fulfilled.match(r), payload: r.payload };
      },
      pay ? `Trip approved, posted to ${provider.name} and marked as paid.` : `Trip approved and posted to ${provider.name}.`,
      "Couldn't approve the trip.",
    );
    if (!done && (payload as { code?: string } | undefined)?.code === "MILEAGE_ACCOUNT_NOT_SET" && canEditSettings(role)) {
      setDetailId(null);
      onOpenSettings();
    }
  };

  const handleReject = async (j: JourneyDto) => {
    if (rejectReason === null) return;
    const { ok } = await run(
      "reject",
      async () => {
        const r = await dispatch(rejectJourney({ id: j.id, reason: rejectReason.trim() }));
        return { ok: rejectJourney.fulfilled.match(r), payload: r.payload };
      },
      `Trip rejected. Nothing was sent to ${provider.name}.`,
      "Couldn't reject the trip.",
    );
    if (ok) setRejectReason(null);
  };

  const handleMarkPaid = async (j: JourneyDto) => {
    const ok = await confirmDialog({
      title: "Mark as paid?",
      message: `Record that ${j.driver.name} has been paid back ${money(j.amount)}. Scantrix doesn't send the money.`,
      confirmLabel: "Mark as paid",
    });
    if (!ok) return;
    await run(
      "markPaid",
      async () => {
        const r = await dispatch(markJourneyPaid(j.id));
        return { ok: markJourneyPaid.fulfilled.match(r), payload: r.payload };
      },
      "Trip marked as paid.",
      "Couldn't mark the trip as paid.",
    );
  };

  const handleDelete = async (j: JourneyDto) => {
    const ok = await confirmDialog({
      title: "Delete trip?",
      message: `The ${j.km} km trip on ${shortDate(j.date)} will be deleted.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    const { ok: done } = await run(
      "delete",
      async () => {
        const r = await dispatch(deleteJourney(j.id));
        return { ok: deleteJourney.fulfilled.match(r), payload: r.payload };
      },
      "Trip deleted.",
      "Couldn't delete the trip.",
    );
    if (done) setDetailId(null);
  };

  const closeDetail = () => {
    if (busy) return;
    setDetailId(null);
    setRejectReason(null);
  };

  const columns: DataTableColumn<JourneyDto>[] = [
    { key: "date", header: "Date", width: "12%", render: (j) => <span className="block truncate">{shortDate(j.date)}</span> },
    { key: "driver", header: "Who", width: "17%", render: (j) => <span className="block truncate font-bold">{j.driver.name}</span> },
    { key: "purpose", header: "Purpose", width: "25%", render: (j) => <span className="block truncate text-content-secondary">{j.purpose}</span> },
    { key: "km", header: "km", width: "9%", align: "right", render: (j) => j.km.toLocaleString("en-US") },
    { key: "amount", header: "Amount", width: "13%", align: "right", render: (j) => <span className="font-bold">{money(j.amount)}</span> },
    {
      key: "approver",
      header: "Sent to",
      width: "24%",
      align: "right",
      render: (j) => <span className="block truncate text-content-secondary">{j.approver ? (j.approver.userId === selfId ? "You" : j.approver.name) : "—"}</span>,
    },
  ];

  const canAdd = driverOptions.length > 0 && !driversLoading && !!settings && rate !== null;
  const emptyTitle: Record<View, string> = {
    assigned: "Nothing waiting on you",
    awaiting_review: "No trips awaiting approval",
    awaiting_reimbursement: "Nothing awaiting reimbursement",
    paid: "No paid trips yet",
    rejected: "No rejected trips",
  };

  return (
    <>
      <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
        <div className={TOOLBAR_CLASS}>
          <div className="max-w-full overflow-x-auto">
            <Tabs
              items={[
                ...(approver ? [{ value: "assigned", label: "Assigned to me", count: counts.assigned }] : []),
                ...STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s), count: counts[s] })),
              ]}
              value={view}
              onChange={(v) => setView(v as View)}
            />
          </div>
          <div className="flex w-full items-center gap-[var(--space-sm)] lg:ml-auto lg:w-auto">
            {journeys.length > 0 && (
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search who or purpose…" widthClassName="w-full lg:w-64" />
            )}
            <Button size="sm" onClick={openForm} className="shrink-0" disabled={!canAdd}>
              <Plus size={16} strokeWidth={2.5} />
              Trip
            </Button>
          </div>
        </div>

        {settings && rate === null && (
          <div className="border-b border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-content-secondary">
            The mileage rate isn&apos;t set yet.{" "}
            {canEditSettings(role) ? (
              <button type="button" onClick={onOpenSettings} className="font-bold text-accent hover:underline">
                Set it in Settings
              </button>
            ) : (
              "Ask an owner or admin to set it"
            )}{" "}
            before logging a trip.
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-[var(--space-xl)]">
            <Spinner />
          </div>
        ) : error && journeys.length === 0 ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : visible.length === 0 ? (
          search.trim() ? (
            <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No trips match &quot;{search}&quot;.</div>
          ) : (
            <EmptyState
              icon={<Car size={28} strokeWidth={1.75} />}
              title={emptyTitle[view]}
              description={
                rate === null
                  ? "Business trips are paid per km at the company's rate."
                  : `Log a business trip with its total km and purpose — it's paid ${money(rate)} per km once approved.`
              }
              actionLabel={view === "awaiting_review" && canAdd ? "Add a trip" : undefined}
              onAction={view === "awaiting_review" && canAdd ? openForm : undefined}
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <DataTable
                columns={columns}
                rows={visible}
                getRowKey={(j) => j.id}
                onRowClick={(j) => setDetailId(j.id)}
                bordered={false}
                maxHeightClassName="max-h-[560px]"
              />
            </div>
          </div>
        )}
      </div>

      {/* New trip */}
      <Modal
        open={!!form}
        onClose={closeForm}
        title="New trip"
        widthClassName="max-w-md"
        footer={
          <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
            <Button variant="outline" size="sm" onClick={closeForm} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} loading={creating} disabled={creating || !formApproverId}>
              Send for approval
            </Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-[var(--space-md)]">
            {approver && (
              <SelectDropdown label="Who made the trip *" value={form.driverId} onChange={(e) => patch({ driverId: e.target.value })}>
                {driverOptions.map((d) => (
                  <option key={d.userId} value={d.userId}>
                    {d.name}
                  </option>
                ))}
              </SelectDropdown>
            )}
            <TextInput label="Date *" type="date" value={form.date} onChange={(e) => patch({ date: e.target.value })} />
            <TextInput
              label="Total trip (km) *"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="e.g. 42"
              value={form.km}
              onChange={(e) => patch({ km: e.target.value })}
            />
            <TextInput label="Purpose *" placeholder="e.g. Client meeting at Acme" value={form.purpose} onChange={(e) => patch({ purpose: e.target.value })} />
            {approverOptions.length === 0 ? (
              <p className="rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-status-danger-text">
                There&apos;s nobody else on this company who can approve trips. Ask the owner to invite an admin or accountant.
              </p>
            ) : (
              <SelectDropdown label="Send to *" value={formApproverId} onChange={(e) => patch({ approverId: e.target.value })}>
                <option value="" disabled>
                  Choose an approver
                </option>
                {approverOptions.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} · {m.role}
                  </option>
                ))}
              </SelectDropdown>
            )}

            <div className="flex items-center justify-between rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]">
              <span className="text-body-sm text-content-secondary">
                {km === null || rate === null ? `${rate === null ? "—" : money(rate)} per km` : `${km.toLocaleString("en-US")} km × ${money(rate)}`}
              </span>
              <span className="text-body font-bold text-content-primary">{formAmount === null ? "—" : money(formAmount)}</span>
            </div>

            {formError && <p className="text-caption font-semibold text-status-danger-text">{formError}</p>}
          </div>
        )}
      </Modal>

      {/* Trip detail */}
      <Modal
        open={!!detail}
        onClose={closeDetail}
        title="Trip"
        widthClassName="max-w-lg"
        footer={
          detail ? (
            <TripFooter
              journey={detail}
              providerName={provider.name}
              approver={approver}
              canAct={canAct(detail)}
              selfBlocked={selfBlocked(detail)}
              canDelete={canDelete(detail)}
              rejecting={rejectReason !== null}
              busy={busy}
              onApprove={(pay) => handleApprove(detail, pay)}
              onStartReject={() => setRejectReason("")}
              onCancelReject={() => setRejectReason(null)}
              onConfirmReject={() => handleReject(detail)}
              onMarkPaid={() => handleMarkPaid(detail)}
              onPay={() => setPayId(detail.id)}
              onDelete={() => handleDelete(detail)}
              onClose={closeDetail}
            />
          ) : undefined
        }
      >
        {detail && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Date">{shortDate(detail.date)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Who">{detail.driver.name}</ModalDefinitionRow>
              <ModalDefinitionRow label="Purpose">
                <span className="truncate">{detail.purpose}</span>
              </ModalDefinitionRow>
              <ModalDefinitionRow label="Trip">
                {detail.km.toLocaleString("en-US")} km × {money(detail.rate)}
              </ModalDefinitionRow>
              <ModalDefinitionRow label="Amount">{money(detail.amount)}</ModalDefinitionRow>
              {detail.approver && <ModalDefinitionRow label="Sent to">{detail.approver.userId === selfId ? "You" : detail.approver.name}</ModalDefinitionRow>}
              <ModalDefinitionRow label="Status">
                <Badge variant={CLAIM_STATUS_META[detail.status].variant}>{statusLabel(detail.status)}</Badge>
              </ModalDefinitionRow>
              {detail.publishedAt && (
                <ModalDefinitionRow label={provider.name}>
                  {detail.billUrl ? (
                    <a
                      href={detail.billUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-[var(--space-xs)] font-semibold text-accent hover:underline"
                    >
                      Posted {shortDate(detail.publishedAt)}
                      <ExternalLink size={14} strokeWidth={2.25} />
                    </a>
                  ) : (
                    `Posted ${shortDate(detail.publishedAt)}`
                  )}
                </ModalDefinitionRow>
              )}
              {detail.paidAt && (
                <ModalDefinitionRow label="Paid on">
                  {shortDate(detail.paidAt)}
                  {detail.paidVia === "accounting" ? ` · payment recorded in ${provider.name}` : " · marked as paid"}
                </ModalDefinitionRow>
              )}
            </div>

            {detail.status === "rejected" && (
              <div className="rounded-md border border-status-danger-border bg-status-danger-bg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-status-danger-text">
                <p className="font-semibold">Rejected{detail.rejectionReason ? ":" : ""}</p>
                {detail.rejectionReason && <p>{detail.rejectionReason}</p>}
              </div>
            )}
            {rejectReason !== null && (
              <div className="flex flex-col gap-[var(--space-xs)]">
                <label htmlFor="trip-reject-reason" className="text-body-sm font-semibold text-content-primary">
                  Why is it rejected? <span className="font-normal text-content-secondary">(they see this)</span>
                </label>
                <textarea
                  id="trip-reject-reason"
                  autoFocus
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. Personal errand, not business travel"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full rounded-md border border-border bg-page px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
            )}
            {detail.status === "awaiting_review" && approver && !canAct(detail) && (
              <p className="text-caption text-content-secondary">
                This trip was sent to {detail.approver?.name} — only they, an owner or an admin can approve or reject it.
              </p>
            )}
            {detail.status === "awaiting_review" && canAct(detail) && selfBlocked(detail) && (
              <p className="text-caption text-content-secondary">
                This trip is yours or you logged it, so someone else has to approve it. An owner or admin can allow self-approval in Settings.
              </p>
            )}
          </div>
        )}
      </Modal>

      <PayEmployeeModal
        target={paying ? { id: paying.id, noun: "trip", payee: paying.driver.name, amount: paying.amount, currency: null } : null}
        providerName={provider.name}
        onPay={async (target, bankAccountId, date) => {
          const r = await dispatch(payJourney({ id: target.id, bankAccountId, date }));
          return { ok: payJourney.fulfilled.match(r), payload: r.payload };
        }}
        onClose={() => setPayId(null)}
      />
    </>
  );
}

interface TripFooterProps {
  journey: JourneyDto;
  providerName: string;
  /** Owner/admin/accountant: may mark paid or pay any approved trip, like claims. */
  approver: boolean;
  /** The approver it was sent to, or an owner/admin: may approve or reject it. */
  canAct: boolean;
  selfBlocked: boolean;
  canDelete: boolean;
  rejecting: boolean;
  busy: Busy | null;
  onApprove: (pay: boolean) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onConfirmReject: () => void;
  onMarkPaid: () => void;
  onPay: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function TripFooter({
  journey,
  providerName,
  approver,
  canAct,
  selfBlocked,
  canDelete,
  rejecting,
  busy,
  onApprove,
  onStartReject,
  onCancelReject,
  onConfirmReject,
  onMarkPaid,
  onPay,
  onDelete,
  onClose,
}: TripFooterProps) {
  const disabled = !!busy;
  const row = "flex w-full flex-wrap justify-end gap-[var(--space-sm)]";
  const deleteButton = canDelete && (
    <Button variant="outline" size="sm" onClick={onDelete} loading={busy === "delete"} disabled={disabled}>
      Delete
    </Button>
  );

  if (rejecting) {
    return (
      <div className={row}>
        <Button variant="outline" size="sm" onClick={onCancelReject} disabled={disabled}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirmReject} loading={busy === "reject"} disabled={disabled}>
          Reject trip
        </Button>
      </div>
    );
  }
  if (journey.status === "awaiting_review" && canAct) {
    return (
      <div className={row}>
        {deleteButton}
        <Button variant="outline" size="sm" onClick={onStartReject} disabled={disabled}>
          Reject
        </Button>
        <Button variant="outline" size="sm" onClick={() => onApprove(true)} loading={busy === "approvePay"} disabled={disabled || selfBlocked}>
          Approve & mark paid
        </Button>
        <Button size="sm" onClick={() => onApprove(false)} loading={busy === "approve"} disabled={disabled || selfBlocked}>
          Approve & post to {providerName}
        </Button>
      </div>
    );
  }
  if (journey.status === "awaiting_reimbursement" && approver) {
    return (
      <div className={row}>
        <Button variant="outline" size="sm" onClick={onPay} disabled={disabled}>
          Pay employee
        </Button>
        <Button size="sm" onClick={onMarkPaid} loading={busy === "markPaid"} disabled={disabled}>
          Mark as paid
        </Button>
      </div>
    );
  }
  return (
    <div className={row}>
      {deleteButton}
      <Button variant="outline" size="sm" onClick={onClose} disabled={disabled}>
        Close
      </Button>
    </div>
  );
}
