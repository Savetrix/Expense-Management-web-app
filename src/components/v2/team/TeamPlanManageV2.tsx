"use client";

import { CalendarX2, CreditCard, FileText, Layers, Minus, Plus, RotateCcw, Repeat } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cardLabel } from "@/lib/cardLabel";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/v2/ui/Modal";
import { TextInput } from "@/components/v2/ui/TextInput";
import { SelectDropdown } from "@/components/v2/ui/SelectDropdown";
import { useAppDispatch } from "@/store/hooks";
import {
  cancelTeamScheduledChange,
  changeTeamPlan,
  fetchTeamInvoices,
  previewTeamAddonSlots,
  previewTeamPlanChange,
  setTeamAddonSlots,
  setTeamCancellation,
  startTeamCardSetup,
  type BillingInterval,
  type PaidPlanKey,
  type PlanCard,
  type PlanInvoice,
  type TeamAddonSlotsPreview,
  type TeamBilling,
  type TeamBillingError,
  type TeamPlanChangePreview,
} from "@/store/quickBooks/teamBillingApi";

// Team page › Plan & billing, for a live web plan: what the owner does on
// their Subscription page and in Manage billing, done here by the owner's
// team admins (Scantrix_API stripe.service.js "Managing a plan in the app").
// Upgrades and extra slots are charged now to the plan's card; moving down
// and cancelling wait for the period end; "Pay with my card" makes the
// viewer's card the one every renewal and change is charged to.

const money = (amount: number) => `$${amount.toFixed(2)}`;

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const cardText = (card: PlanCard | null) => (card ? cardLabel(card) : "the card on file");

/** Whose card the plan is charged to, from the viewer's side. */
export const cardOwnerText = (billing: TeamBilling, ownerName: string) =>
  billing.paidBy ? (billing.paidBy.isYou ? "your card" : `${billing.paidBy.name ?? "a team admin"}'s card`) : `${ownerName}'s card`;

const per = (interval: BillingInterval) => (interval === "yearly" ? "/yr" : "/mo");
// More slots = a bigger plan.
const PLAN_RANK: Record<PaidPlanKey, number> = { standard: 1, enterprise: 2 };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface PanelProps {
  qbId: string;
  billing: TeamBilling;
  ownerName: string;
  /** The card's fresh state after a change. */
  onBilling: (billing: TeamBilling) => void;
}

// Sends the browser to Stripe's page for the viewer's card, after saying
// plainly what it means — the card then pays for everything on this plan.
export async function payWithMyCard(dispatch: ReturnType<typeof useAppDispatch>, qbId: string, ownerName: string, billing: TeamBilling) {
  const confirmed = await confirmDialog({
    title: `Pay for ${ownerName}'s plan with your card?`,
    message: [
      `You'll enter your card on Stripe's secure page. From then on it pays for ${ownerName}'s whole plan (every company of theirs):`,
      `• every renewal (${billing.planName}${billing.billingInterval ? `, ${billing.billingInterval}` : ""})`,
      `• any upgrade or extra slots that you, ${ownerName} or another admin buy — charged right away`,
      ...(billing.paymentPending ? ["• what's overdue now, charged as soon as the card is saved"] : []),
      "",
      `It stays your card until someone else puts theirs on the plan, the plan is cancelled, or you leave ${ownerName}'s team (then it comes off by itself).`,
    ].join("\n"),
    confirmLabel: "Continue to Stripe",
    size: "wide",
  });
  if (!confirmed) return;
  const result = await dispatch(startTeamCardSetup(qbId));
  if (startTeamCardSetup.fulfilled.match(result)) window.location.href = result.payload;
  else showToast(result.payload?.message ?? "Could not open the card page.", "error");
}

// A failed change the viewer must act on, or at least hear about plainly.
async function reportChangeError(payload: TeamBillingError | undefined, fallback: string) {
  if (payload?.code === "PAYMENT_ACTION_REQUIRED" && payload.hostedInvoiceUrl) {
    const open = await confirmDialog({
      title: "The bank needs to approve this payment",
      message: `${payload.message} It has to be approved on Stripe's payment page (by whoever's card it is). The change applies as soon as it's paid.`,
      confirmLabel: "Open payment page",
    });
    if (open) window.open(payload.hostedInvoiceUrl, "_blank", "noopener");
  } else if (!payload?.statusCode) {
    // Timed out or the connection dropped: it may still have gone through.
    showToast("We couldn't confirm the result. Check the plan below before trying again.", "warning");
  } else {
    showToast(payload.message || fallback, "error");
  }
}

export function TeamPlanManageV2({ qbId, billing, ownerName, onBilling }: PanelProps) {
  const dispatch = useAppDispatch();
  const [changeOpen, setChangeOpen] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "resume" | "scheduled" | null>(null);

  const ends = !!billing.endsAt;

  const handleCancel = async () => {
    const confirmed = await confirmDialog({
      title: `Cancel ${ownerName}'s plan?`,
      message: `Nothing more is charged. The plan stays until ${formatDate(billing.currentPeriodEnd)}; after that ${ownerName}'s companies can't scan or post until someone buys a plan again. Nothing is refunded for this period. You can resume it until then.`,
      confirmLabel: "Cancel plan",
      cancelLabel: "Keep it",
      tone: "destructive",
    });
    if (!confirmed) return;
    setBusy("cancel");
    const result = await dispatch(setTeamCancellation({ qbId, cancel: true }));
    setBusy(null);
    if (setTeamCancellation.fulfilled.match(result)) {
      onBilling(result.payload.billing);
      showToast(result.payload.message, "success");
    } else await reportChangeError(result.payload, "Could not cancel the plan.");
  };

  const handleResume = async () => {
    setBusy("resume");
    const result = await dispatch(setTeamCancellation({ qbId, cancel: false }));
    setBusy(null);
    if (setTeamCancellation.fulfilled.match(result)) {
      onBilling(result.payload.billing);
      showToast(result.payload.message, "success");
    } else await reportChangeError(result.payload, "Could not resume the plan.");
  };

  const handleCancelScheduled = async () => {
    const change = billing.scheduledChange;
    if (!change) return;
    const confirmed = await confirmDialog({
      title: "Cancel the scheduled change?",
      message: `The plan won't move to ${change.planName} (${change.billingInterval}) on ${formatDate(change.at)}. It keeps renewing as ${billing.planName} (${billing.billingInterval}).`,
      confirmLabel: "Cancel the change",
      cancelLabel: "Keep it",
    });
    if (!confirmed) return;
    setBusy("scheduled");
    const result = await dispatch(cancelTeamScheduledChange(qbId));
    setBusy(null);
    if (cancelTeamScheduledChange.fulfilled.match(result)) {
      onBilling(result.payload.billing);
      showToast(result.payload.message, "success");
    } else await reportChangeError(result.payload, "Could not cancel the scheduled change.");
  };

  const actionClass =
    "flex items-center gap-[var(--space-sm)] rounded-lg border border-border px-[var(--space-md)] py-[var(--space-sm)] text-left text-body-sm font-semibold text-text-primary hover:bg-surface-alt disabled:opacity-60";

  return (
    <>
      {billing.scheduledChange && (
        <div className="mt-[var(--space-sm)] flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-lg border border-primary/30 bg-primary/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
          <span>
            Moves to{" "}
            <strong className="text-text-primary">
              {billing.scheduledChange.planName} ({billing.scheduledChange.billingInterval})
            </strong>{" "}
            on {formatDate(billing.scheduledChange.at)}.
          </span>
          <button type="button" onClick={handleCancelScheduled} disabled={busy !== null} className="font-semibold text-primary hover:underline">
            {busy === "scheduled" ? <Spinner size="sm" /> : "Cancel change"}
          </button>
        </div>
      )}

      {ends && (
        <div className="mt-[var(--space-sm)] flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-lg border border-warning/30 bg-warning/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
          <span>
            {billing.payerLeft
              ? `${billing.payerLeft.name ?? "A team admin"} left the team and their card came off the plan, so it ends on `
              : "Cancelled. The plan ends on "}
            <strong className="text-text-primary">{formatDate(billing.endsAt)}</strong>.
            {!billing.card && " Add a card to keep it going."}
          </span>
          {billing.card ? (
            <button type="button" onClick={handleResume} disabled={busy !== null} className="font-semibold text-primary hover:underline">
              {busy === "resume" ? <Spinner size="sm" /> : "Resume"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => payWithMyCard(dispatch, qbId, ownerName, billing)}
              className="font-semibold text-primary hover:underline"
            >
              Pay with my card
            </button>
          )}
        </div>
      )}

      {billing.payerLeft && !ends && (
        <p className="mt-[var(--space-sm)] text-caption text-text-secondary">
          {billing.payerLeft.name ?? "A team admin"} left the team, so their card came off the plan. It&apos;s charged to{" "}
          {ownerName}&apos;s card now.
        </p>
      )}

      {billing.paymentPending && (
        <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-xs)] rounded-lg border border-error/30 bg-error/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
          <span>
            {billing.status === "past_due"
              ? `The last payment on ${cardOwnerText(billing, ownerName)} didn't go through. Put a card on the plan to pay it now.`
              : "A payment is waiting for the bank's approval."}
          </span>
          <div className="flex flex-wrap gap-[var(--space-md)]">
            <button
              type="button"
              onClick={() => payWithMyCard(dispatch, qbId, ownerName, billing)}
              className="font-semibold text-primary hover:underline"
            >
              Pay with my card
            </button>
            {billing.paymentPending.hostedInvoiceUrl && (
              <a href={billing.paymentPending.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                Open the invoice
              </a>
            )}
          </div>
        </div>
      )}

      <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
        <button type="button" className={actionClass} onClick={() => setChangeOpen(true)} disabled={ends}>
          <Repeat size={16} strokeWidth={2.25} />
          Change plan
        </button>
        {billing.addon && (
          <button type="button" className={actionClass} onClick={() => setSlotsOpen(true)} disabled={ends || !billing.addon.purchasable}>
            <Layers size={16} strokeWidth={2.25} />
            Extra slots
          </button>
        )}
        <button type="button" className={actionClass} onClick={() => payWithMyCard(dispatch, qbId, ownerName, billing)}>
          <CreditCard size={16} strokeWidth={2.25} />
          {billing.paidBy?.isYou ? "Change my card" : "Pay with my card"}
        </button>
        <button type="button" className={actionClass} onClick={() => setInvoicesOpen(true)}>
          <FileText size={16} strokeWidth={2.25} />
          Invoices
        </button>
        {ends ? (
          billing.card && (
            <button type="button" className={actionClass} onClick={handleResume} disabled={busy !== null}>
              {busy === "resume" ? <Spinner size="sm" /> : <RotateCcw size={16} strokeWidth={2.25} />}
              Resume plan
            </button>
          )
        ) : (
          <button type="button" className={`${actionClass} text-status-danger-text`} onClick={handleCancel} disabled={busy !== null}>
            {busy === "cancel" ? <Spinner size="sm" /> : <CalendarX2 size={16} strokeWidth={2.25} />}
            Cancel plan
          </button>
        )}
      </div>
      <p className="mt-[var(--space-sm)] text-caption text-text-secondary">
        Upgrades and extra slots are charged right away to {cardOwnerText(billing, ownerName)}. Moving to a smaller plan and
        cancelling take effect at the end of the period.
      </p>

      {changeOpen && (
        <ChangePlanModal
          qbId={qbId}
          billing={billing}
          ownerName={ownerName}
          onClose={() => setChangeOpen(false)}
          onBilling={(next) => {
            onBilling(next);
            setChangeOpen(false);
          }}
        />
      )}
      {slotsOpen && billing.addon && (
        <ExtraSlotsModal
          qbId={qbId}
          billing={billing}
          ownerName={ownerName}
          onClose={() => setSlotsOpen(false)}
          onBilling={(next) => {
            onBilling(next);
            setSlotsOpen(false);
          }}
        />
      )}
      {invoicesOpen && <InvoicesModal qbId={qbId} ownerName={ownerName} onClose={() => setInvoicesOpen(false)} />}
    </>
  );
}

interface ModalProps {
  qbId: string;
  billing: TeamBilling;
  ownerName: string;
  onClose: () => void;
  onBilling: (billing: TeamBilling) => void;
}

function ChangePlanModal({ qbId, billing, ownerName, onClose, onBilling }: ModalProps) {
  const dispatch = useAppDispatch();
  const currentPlan = billing.plan === "trial" ? "standard" : billing.plan;
  const currentInterval = billing.billingInterval ?? "monthly";
  const [plan, setPlan] = useState<PaidPlanKey>(currentPlan);
  const [interval, setBillingInterval] = useState<BillingInterval>(currentInterval);
  const [coupon, setCoupon] = useState("");
  const [preview, setPreview] = useState<TeamPlanChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const same = plan === currentPlan && interval === currentInterval;
  // Same rule as the API (stripe.service.js isUpgrade): more slots, or yearly
  // on the same plan. Only an upgrade takes a coupon — a typed one is kept for
  // when the choice goes back up, but never sent with a move down.
  const upgrade = PLAN_RANK[plan] > PLAN_RANK[currentPlan] || (plan === currentPlan && interval === "yearly" && currentInterval === "monthly");
  const couponCode = upgrade && coupon.trim() ? coupon.trim() : undefined;

  useEffect(() => {
    const mine = ++seq.current;
    setPreview(null);
    setPreviewError(null);
    if (same) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = setTimeout(async () => {
      const result = await dispatch(
        previewTeamPlanChange({ qbId, plan, billingInterval: interval, ...(couponCode && { couponCode }) }),
      );
      if (mine !== seq.current) return;
      setPreviewing(false);
      if (previewTeamPlanChange.fulfilled.match(result)) setPreview(result.payload);
      else setPreviewError(result.payload?.message ?? "Could not price this change.");
    }, 350);
    return () => clearTimeout(timer);
  }, [qbId, plan, interval, couponCode, same, attempt, dispatch]);

  const overBy = preview ? billing.slotsUsed - preview.slotsAfter : 0;

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    const result = await dispatch(
      changeTeamPlan({
        qbId,
        plan,
        billingInterval: interval,
        ...(couponCode && preview.kind === "upgrade" && { couponCode }),
        ...(preview.kind === "upgrade" && { prorationDate: preview.prorationDate, expectedAmountDue: preview.amountDueNow }),
      }),
    );
    setSaving(false);
    if (changeTeamPlan.fulfilled.match(result)) {
      showToast(
        result.payload.charge ? `${result.payload.message} Paid ${money(result.payload.charge.amount)}.` : result.payload.message,
        "success",
      );
      onBilling(result.payload.billing);
    } else if (result.payload?.code === "PRICE_CHANGED") {
      showToast(result.payload.message, "warning");
      setAttempt((n) => n + 1);
    } else {
      await reportChangeError(result.payload, "Could not change the plan.");
    }
  };

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={`Change ${ownerName}'s plan`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-content-secondary hover:bg-surface-alt"
          >
            Cancel
          </button>
          <Button size="sm" onClick={handleSave} loading={saving} disabled={!preview || previewing}>
            {preview?.kind === "upgrade" ? `Pay ${money(preview.amountDueNow)}` : preview?.kind === "downgrade" ? "Schedule the change" : "Change plan"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <p className="text-body-sm text-text-secondary">
          Now: <strong className="text-text-primary">{billing.planName}</strong> ({currentInterval})
          {billing.addonSlots > 0 && ` with ${plural(billing.addonSlots, "extra slot")}`}.
        </p>
        <SelectDropdown label="Plan" value={plan} onChange={(event) => setPlan(event.target.value as PaidPlanKey)}>
          <option value="standard">Standard</option>
          <option value="enterprise">Enterprise</option>
        </SelectDropdown>
        <SelectDropdown label="Billing" value={interval} onChange={(event) => setBillingInterval(event.target.value as BillingInterval)}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </SelectDropdown>
        {upgrade && (
          <TextInput
            label="Coupon code (optional, upgrades only)"
            placeholder="SAVE5"
            value={coupon}
            onChange={(event) => setCoupon(event.target.value.toUpperCase())}
          />
        )}

        <div className="rounded-lg bg-background-soft px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
          {same ? (
            "Pick a different plan or billing period."
          ) : previewError ? (
            <span className="text-status-danger-text">{previewError}</span>
          ) : previewing || !preview ? (
            <span className="flex items-center gap-[var(--space-sm)]">
              <Spinner size="sm" /> Working out the price…
            </span>
          ) : preview.kind === "upgrade" ? (
            <div className="flex flex-col gap-1">
              <span>
                Charged now: <strong className="text-text-primary">{money(preview.amountDueNow)}</strong> to{" "}
                {cardText(preview.paymentMethod)} ({cardOwnerText(billing, ownerName)}), for the rest of this period
                {preview.discountNow > 0 && ` after ${money(preview.discountNow)} off`}. No payment page opens.
              </span>
              <span>
                From {formatDate(preview.renewalDate)}:{" "}
                <strong className="text-text-primary">
                  {money(preview.renewalAmount)}
                  {per(preview.billingInterval)}
                </strong>{" "}
                for {preview.planName}
                {preview.extraSlots > 0 && ` with ${plural(preview.extraSlots, "extra slot")}`} ({preview.slotsAfter} companies).
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span>
                No charge now. {ownerName} keeps {billing.planName} until{" "}
                <strong className="text-text-primary">{formatDate(preview.effectiveAt)}</strong>, then {preview.planName} (
                {preview.billingInterval}):{" "}
                <strong className="text-text-primary">
                  {money(preview.renewalAmount)}
                  {per(preview.billingInterval)}
                </strong>
                .
              </span>
              {preview.extraSlotsDropped > 0 && <span>{plural(preview.extraSlotsDropped, "extra slot")} end then too.</span>}
            </div>
          )}
        </div>
        {preview && overBy > 0 && (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
            {ownerName} has {billing.slotsUsed} connected companies and this plan allows {preview.slotsAfter}.{" "}
            {preview.kind === "downgrade" ? `On ${formatDate(preview.effectiveAt)}` : "Then"} {plural(overBy, "company")} with
            the fewest invoices {overBy === 1 ? "is" : "are"} disconnected.
          </p>
        )}
      </div>
    </Modal>
  );
}

function ExtraSlotsModal({ qbId, billing, ownerName, onClose, onBilling }: ModalProps) {
  const dispatch = useAppDispatch();
  const addon = billing.addon!;
  const interval = billing.billingInterval ?? "monthly";
  // What Stripe bills from next period — below addonSlots while a removal waits.
  const billedNext = billing.addonSlotsNext ?? billing.addonSlots;
  const [target, setTarget] = useState(billedNext);
  const [preview, setPreview] = useState<TeamAddonSlotsPreview | null>(null);
  const [previewError, setPreviewError] = useState<TeamBillingError | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const changed = target !== billedNext;
  const buying = target > billing.addonSlots;
  const removing = target < billedNext;

  useEffect(() => {
    const mine = ++seq.current;
    setPreview(null);
    setPreviewError(null);
    if (!changed) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = setTimeout(async () => {
      const result = await dispatch(previewTeamAddonSlots({ qbId, quantity: target }));
      if (mine !== seq.current) return;
      setPreviewing(false);
      if (previewTeamAddonSlots.fulfilled.match(result)) setPreview(result.payload);
      else setPreviewError(result.payload ?? { message: "Could not price extra slots." });
    }, 300);
    return () => clearTimeout(timer);
  }, [qbId, target, changed, attempt, dispatch]);

  const limitAfter = billing.maxSlots - billing.addonSlots + target;
  const overBy = billing.slotsUsed - limitAfter;

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    const result = await dispatch(
      setTeamAddonSlots({ qbId, quantity: target, prorationDate: preview.prorationDate, expectedAmountDue: preview.amountDueNow }),
    );
    setSaving(false);
    if (setTeamAddonSlots.fulfilled.match(result)) {
      showToast(result.payload.message, "success");
      onBilling(result.payload.billing);
    } else if (result.payload?.code === "PRICE_CHANGED") {
      showToast(result.payload.message, "warning");
      setAttempt((n) => n + 1);
    } else {
      await reportChangeError(result.payload, "Could not update extra slots.");
    }
  };

  const stepClass =
    "flex h-11 w-11 items-center justify-center rounded-lg border border-border text-text-primary hover:bg-surface-alt disabled:opacity-40";

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={`Extra slots on ${ownerName}'s plan`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-content-secondary hover:bg-surface-alt"
          >
            Cancel
          </button>
          <Button size="sm" onClick={handleSave} loading={saving} disabled={!changed || !preview || previewing}>
            {buying && preview ? `Pay ${money(preview.amountDueNow)}` : removing ? "Reduce slots" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <p className="text-body-sm text-text-secondary">
          {money(addon.prices[interval])}
          {per(interval)} each, up to {addon.maxSlots}. They renew and end with the plan.
        </p>
        {billing.addonSlotsNext != null && (
          <p className="text-body-sm text-text-secondary">
            Drops to {plural(billing.addonSlotsNext, "extra slot")} on {formatDate(billing.addonSlotsNextAt)}.
          </p>
        )}
        <div className="flex items-center justify-between gap-[var(--space-md)]">
          <div className="flex items-center gap-[var(--space-sm)]">
            <button type="button" aria-label="One fewer extra slot" className={stepClass} onClick={() => setTarget((n) => Math.max(0, n - 1))} disabled={target <= 0 || saving}>
              <Minus size={18} strokeWidth={2.5} />
            </button>
            <span className="min-w-[3ch] text-center text-h3 font-bold text-text-primary" aria-live="polite">
              {target}
            </span>
            <button
              type="button"
              aria-label="One more extra slot"
              className={stepClass}
              onClick={() => setTarget((n) => Math.min(addon.maxSlots, n + 1))}
              disabled={target >= addon.maxSlots || saving}
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>
          <p className="text-caption text-text-secondary">
            Total: <strong className="text-text-primary">{limitAfter} companies</strong>
          </p>
        </div>

        {changed && (
          <div className="rounded-lg bg-background-soft px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
            {previewError ? (
              <div className="flex flex-col gap-[var(--space-sm)]">
                <span className="text-status-danger-text">{previewError.message}</span>
                {previewError.code === "ADDON_REMOVAL_PENDING" && previewError.keepQuantity != null ? (
                  <button type="button" onClick={() => setTarget(previewError.keepQuantity!)} className="self-start font-semibold text-primary hover:underline">
                    Keep the {plural(previewError.keepQuantity, "paid slot")} first
                  </button>
                ) : (
                  <button type="button" onClick={() => setAttempt((n) => n + 1)} className="self-start font-semibold text-primary hover:underline">
                    Try again
                  </button>
                )}
              </div>
            ) : previewing || !preview ? (
              <span className="flex items-center gap-[var(--space-sm)]">
                <Spinner size="sm" /> Working out the price…
              </span>
            ) : buying ? (
              <span>
                Charged now: <strong className="text-text-primary">{money(preview.amountDueNow)}</strong> to{" "}
                {cardText(preview.paymentMethod)} ({cardOwnerText(billing, ownerName)}), for the rest of this period. From{" "}
                {formatDate(preview.renewalDate)}: {money(preview.renewalAmount)}
                {per(interval)}.
              </span>
            ) : removing ? (
              <span>
                No charge or refund. The slots stay until {formatDate(preview.effectiveAt)}; from then{" "}
                {money(preview.renewalAmount)}
                {per(interval)}.
              </span>
            ) : (
              <span>No charge, these are already paid for this period. They keep renewing with the plan.</span>
            )}
          </div>
        )}
        {changed && overBy > 0 && (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
            {ownerName} has {billing.slotsUsed} connected companies. With {limitAfter} slots, {plural(overBy, "company")} with
            the fewest invoices {overBy === 1 ? "is" : "are"} disconnected when the removal takes effect.
          </p>
        )}
      </div>
    </Modal>
  );
}

const INVOICE_STATUS: Record<PlanInvoice["status"], string> = {
  paid: "Paid",
  open: "Due",
  uncollectible: "Unpaid",
  void: "Void",
};

function InvoicesModal({ qbId, ownerName, onClose }: { qbId: string; ownerName: string; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [invoices, setInvoices] = useState<PlanInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    dispatch(fetchTeamInvoices(qbId)).then((result) => {
      if (!live) return;
      if (fetchTeamInvoices.fulfilled.match(result)) setInvoices(result.payload);
      else setError(result.payload?.message ?? "Could not load the invoices.");
    });
    return () => {
      live = false;
    };
  }, [qbId, dispatch]);

  return (
    <Modal open onClose={onClose} title={`Invoices for ${ownerName}'s plan`}>
      {error ? (
        <p className="text-body-sm text-status-danger-text">{error}</p>
      ) : !invoices ? (
        <div className="flex justify-center py-[var(--space-md)]">
          <Spinner size="sm" />
        </div>
      ) : invoices.length === 0 ? (
        <p className="text-body-sm text-text-secondary">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex items-center justify-between gap-[var(--space-sm)] py-[var(--space-sm)] text-body-sm">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary">{formatDate(invoice.date)}</p>
                <p className="truncate text-caption text-text-secondary">{invoice.number ?? invoice.id}</p>
              </div>
              <div className="flex shrink-0 items-center gap-[var(--space-md)]">
                <span className="text-text-primary">{money(invoice.total)}</span>
                <span className={invoice.status === "paid" ? "text-success" : invoice.status === "open" ? "text-warning" : "text-text-secondary"}>
                  {INVOICE_STATUS[invoice.status] ?? invoice.status}
                </span>
                {invoice.url && (
                  <a href={invoice.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                    View
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
