"use client";

import Link from "next/link";
import { ArrowRight, CalendarRange } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/v2/monthEnd/shared";
import { Modal } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoiceDetails, updateInvoiceExtractedData } from "@/store/invoice/invoiceApi";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";
import { fetchPrepayments } from "@/store/monthEnd/monthEndApi";
import type { PrepaymentDto } from "@/store/monthEnd/monthEndApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { prepaymentError, servicePeriodDays } from "./PrepaymentFields";

// On a posted invoice: its prepayment schedule (with a link to Month-End), or
// "Mark as prepayment" for one the scanner didn't flag — that moves its bill
// to the prepaid account and leaves a draft schedule to publish.
// Bookkeeping roles only; the month-end API refuses contributors.
const POSTING_ROLES = new Set(["owner", "admin", "accountant"]);

const INPUT_CLASS =
  "mt-[var(--space-xs)] h-10 w-full rounded-md border border-border bg-page px-[var(--space-sm)] text-body-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40";

/** recreate: the bill is already on prepaid and only its schedule is missing. */
function MarkAsPrepaymentModal({
  invoice,
  recreate = false,
  onClose,
  onDone,
}: {
  invoice: InvoiceRecord;
  recreate?: boolean;
  onClose: () => void;
  onDone: () => Promise<boolean>;
}) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const [start, setStart] = useState(invoice.extractedData?.servicePeriodStart ?? "");
  const [end, setEnd] = useState(invoice.extractedData?.servicePeriodEnd ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const days = servicePeriodDays(start, end);

  const submit = async () => {
    const problem = prepaymentError(true, start, end);
    if (problem) return setError(problem);
    setSaving(true);
    setError("");
    const result = await dispatch(
      updateInvoiceExtractedData({ invoiceId: invoice._id, extractedData: { isPrepayment: true, servicePeriodStart: start, servicePeriodEnd: end } }),
    );
    setSaving(false);
    if (updateInvoiceExtractedData.fulfilled.match(result)) {
      // The bill moved; the draft is made best-effort, so check it's there.
      if (await onDone()) showToast("Marked as a prepayment — review its schedule on Month-End.", "success");
      else showToast("The bill moved to the prepaid account, but its schedule couldn't be made — use Create schedule to try again.", "warning");
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      setError(typeof payload === "string" ? payload : payload?.message || "Couldn't mark it as a prepayment.");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={recreate ? "Create prepayment schedule" : "Mark as prepayment"}
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={saving}>
            {recreate ? "Create schedule" : "Mark as prepayment"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <p className="text-body-sm text-content-secondary">
          {`The bill in ${provider.name} moves to the prepaid account, and a schedule that releases it to this invoice's GL account month by month is made for you to review and publish.`}
        </p>
        <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
          <label className="text-caption font-semibold text-content-secondary">
            Service start
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="text-caption font-semibold text-content-secondary">
            Service end
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT_CLASS} />
          </label>
        </div>
        {days != null && <p className="text-caption text-content-secondary">Covers {days} days.</p>}
        {error && <p className="text-caption font-semibold text-error">{error}</p>}
      </div>
    </Modal>
  );
}

export function InvoicePrepaymentCard({ invoice }: { invoice: InvoiceRecord }) {
  const dispatch = useAppDispatch();
  const connections = useAppSelector((state) => state.quickBooks.connections);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const active = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const canPost = POSTING_ROLES.has(active?.role ?? "");
  const posted = invoice.postedStatus === "auto" || invoice.postedStatus === "manual";
  const eligible = canPost && posted && !invoice.claimReceipt && !invoice.expenseClaimId;

  // null = loading; "error" = the read failed (never shown as "no schedule").
  const [schedules, setSchedules] = useState<PrepaymentDto[] | "error" | null>(null);
  const [marking, setMarking] = useState(false);

  /** → whether the invoice now has a live schedule. */
  const load = useCallback(async () => {
    const result = await dispatch(fetchPrepayments({ invoiceId: invoice._id }));
    if (!fetchPrepayments.fulfilled.match(result)) {
      setSchedules("error");
      return false;
    }
    setSchedules(result.payload);
    return result.payload.some((s) => s.status !== "archived");
  }, [dispatch, invoice._id]);

  useEffect(() => {
    if (eligible) void load();
  }, [eligible, load]);

  if (!eligible || schedules === null) return null;
  const list = schedules === "error" ? [] : schedules;
  const live = list.find((s) => s.status !== "archived");
  const archived = list.find((s) => s.status === "archived");
  const isPrepayment = invoice.extractedData?.isPrepayment === true;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-[var(--space-sm)] border-b border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
        <CalendarRange size={16} strokeWidth={2} className="text-content-muted" />
        <span className="text-caption font-bold uppercase tracking-wide text-content-secondary">Prepayment</span>
        {live && <StatusBadge status={live.displayStatus} />}
      </div>
      <div className="flex flex-col gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-body-sm">
        {schedules === "error" ? (
          <p className="text-content-secondary">
            Couldn&apos;t check its prepayment schedule.{" "}
            <button type="button" onClick={() => void load()} className="font-bold text-accent hover:underline">
              Try again
            </button>
          </p>
        ) : live ? (
          <>
            <p className="text-content-secondary">
              Posted to {live.balanceAccountName ?? "the prepaid account"} and released to {live.pnlAccountName ?? "expense"} over {live.months} months.
              {live.status === "review" && " Publish the schedule to post its journals."}
            </p>
            <Link href={`/month-end?prepayment=${live._id}`} className="inline-flex items-center gap-1 font-bold text-accent hover:underline">
              {live.status === "review" ? "Review schedule" : "View schedule"}
              <ArrowRight size={14} strokeWidth={2.25} />
            </Link>
          </>
        ) : isPrepayment && archived ? (
          <p className="text-content-secondary">
            Its schedule is archived.{" "}
            <Link href={`/month-end?prepayment=${archived._id}`} className="font-bold text-accent hover:underline">
              Restore it on Month-End
            </Link>
            .
          </p>
        ) : isPrepayment ? (
          // On the prepaid account but no schedule was made (best-effort on the server).
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
            <p className="text-content-secondary">Its bill is on the prepaid account, but it has no release schedule yet.</p>
            <Button size="sm" variant="outline" onClick={() => setMarking(true)}>
              Create schedule
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
            <p className="text-content-secondary">Paid for more than a month? Spread it over the months it covers.</p>
            <Button size="sm" variant="outline" onClick={() => setMarking(true)}>
              Mark as prepayment
            </Button>
          </div>
        )}
      </div>
      {marking && (
        <MarkAsPrepaymentModal
          invoice={invoice}
          recreate={invoice.extractedData?.isPrepayment === true}
          onClose={() => setMarking(false)}
          onDone={async () => {
            setMarking(false);
            dispatch(getInvoiceDetails(invoice._id));
            return load();
          }}
        />
      )}
    </div>
  );
}
