"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { confirmDialog, showToast } from "@/lib/dialogManager";
import { Spinner } from "@/components/ui/Spinner";
import { useAppDispatch } from "@/store/hooks";
import {
  fetchMySubscription,
  previewAddonSlots,
  updateAddonSlots,
  type AddonSlotsCharge,
  type AddonSlotsPreview,
  type SavedCard,
} from "@/store/subscription/subscriptionApi";
import type { MySubscription } from "@/store/subscription/subscriptionSlice";

function formatMoney(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const plural = (n: number) => `${n} extra slot${n === 1 ? "" : "s"}`;

const BRAND_NAMES: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };

function cardLabel(card: SavedCard | null) {
  if (!card) return "your saved card";
  return `${BRAND_NAMES[card.brand] ?? card.brand} •••• ${card.last4}`;
}

interface ExtraSlotsCardV2Props {
  subscription: MySubscription;
  /** Start one slot above the current count (the add-account modal's "Buy extra slot" link). */
  startWithOneMore?: boolean;
}

// Enterprise add-on: extra accounting slots billed on the same Stripe
// subscription as the plan (see Scantrix_API stripe.service.js setAddonSlots).
// Buying charges now, prorated; removing keeps the paid slots until the
// period ends — the backend decides both, this card only previews and confirms.
export function ExtraSlotsCardV2({ subscription, startWithOneMore = false }: ExtraSlotsCardV2Props) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const addon = subscription.addon;
  const interval = subscription.billingInterval ?? "monthly";
  const intervalSuffix = interval === "yearly" ? "/yr" : "/mo";

  // What Stripe bills from next period — below addonSlots while a removal waits.
  const billedNext = subscription.addonSlotsNext ?? subscription.addonSlots;
  const maxExtra = addon?.maxSlots ?? 0;
  // One more than usable right now — with a removal waiting, billedNext + 1
  // would only win back a slot already paid for, not add one.
  const [target, setTarget] = useState(() =>
    startWithOneMore ? Math.min(subscription.addonSlots + 1, maxExtra) : billedNext,
  );
  const [preview, setPreview] = useState<AddonSlotsPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<{ message: string; hostedInvoiceUrl?: string | null } | null>(null);
  // Bumped by "Try again" to re-run the preview for the same target.
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  // The target to come back to after "Keep my slots" refetches the subscription.
  const targetAfterKeep = useRef<number | null>(null);
  // The last purchase, for the "Paid … · View receipt" note.
  const [lastCharge, setLastCharge] = useState<AddonSlotsCharge | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Only the latest preview request may land.
  const previewSeq = useRef(0);

  // The add-account modal's "Add a slot" link (?addSlot=1) — also when this
  // page is already open. The param is dropped once applied, so the next
  // click sets it afresh.
  useEffect(() => {
    if (!startWithOneMore) return;
    setTarget(Math.min(subscription.addonSlots + 1, maxExtra));
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    router.replace("/subscription", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWithOneMore]);

  // A changed count (after a save, or a webhook-driven refetch) resets the
  // stepper — but not on mount, where startWithOneMore may have set it.
  const lastBilledNext = useRef(billedNext);
  useEffect(() => {
    if (lastBilledNext.current === billedNext) return;
    lastBilledNext.current = billedNext;
    setTarget(targetAfterKeep.current ?? billedNext);
    targetAfterKeep.current = null;
  }, [billedNext]);

  const changed = target !== billedNext;
  // Three kinds of change, measured against what's paid now (addonSlots) and
  // what Stripe bills next (billedNext — lower while a removal waits):
  //   buying   — more than paid for now: charged today
  //   removing — fewer than billed next: no refund, applies at period end
  //   keeping  — back up to slots already paid for (cancels part or all of a
  //              waiting removal): free
  const buying = target > subscription.addonSlots;
  const removing = target < billedNext;
  const keeping = changed && !buying && !removing;
  // The backend refuses to buy past a waiting removal (ADDON_REMOVAL_PENDING)
  // until the paid slots are kept — a free change of its own, offered below.
  const removalBlocksPurchase = subscription.addonSlotsNext != null && buying;

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    const seq = ++previewSeq.current;
    if (!changed || !addon?.purchasable || removalBlocksPurchase) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = setTimeout(async () => {
      const result = await dispatch(previewAddonSlots(target));
      if (seq !== previewSeq.current) return;
      setPreviewing(false);
      if (previewAddonSlots.fulfilled.match(result)) setPreview(result.payload);
      else
        setPreviewError({
          message: result.payload?.message || "Could not price extra slots.",
          hostedInvoiceUrl: result.payload?.hostedInvoiceUrl,
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [target, changed, addon?.purchasable, removalBlocksPurchase, previewAttempt, dispatch]);

  if (!addon) return null;

  const perSlot = addon.prices[interval];
  const limitAfter = subscription.baseSlots + target;
  const overLimitAfter = subscription.slotsUsed > limitAfter;

  // A failed save the customer must act on, or at least hear about plainly.
  const reportSaveError = (payload: { message?: string; code?: string; statusCode?: number } | undefined) => {
    if (payload?.code === "PRICE_CHANGED") {
      showToast(payload.message || "The price changed — please review it again.", "warning");
      setPreviewAttempt((n) => n + 1);
    } else if (!payload?.statusCode) {
      // Timed out or the connection dropped: the change may still have gone
      // through at Stripe. The refetch below shows what actually happened.
      showToast("We couldn't confirm the result. Check your extra slots below before trying again.", "warning");
    } else {
      showToast(payload.message || "Could not update extra slots. Please try again.", "error");
    }
  };

  const handleKeepSlots = async () => {
    const confirmed = await confirmDialog({
      title: `Keep your ${plural(subscription.addonSlots)}?`,
      message: `No charge — you've already paid for them this period. They'll keep renewing with your ${subscription.planName} plan, and then you can add more.`,
      confirmLabel: "Keep slots",
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      // Confirmed as free: if it's no longer free, the server refuses to charge.
      const result = await dispatch(updateAddonSlots({ quantity: subscription.addonSlots, expectedAmountDue: 0 }));
      if (updateAddonSlots.fulfilled.match(result)) {
        showToast(`Your ${plural(subscription.addonSlots)} will keep renewing.`, "success");
        targetAfterKeep.current = target;
      } else {
        reportSaveError(result.payload);
      }
    } finally {
      setSaving(false);
      dispatch(fetchMySubscription({ force: true }));
    }
  };

  // The renewal invoice, line by line — the plan's own price never changes here.
  const renewalBreakdown = (p: AddonSlotsPreview) =>
    [
      `From ${formatDate(p.renewalDate)}, each renewal is ${formatMoney(p.renewalAmount)}${intervalSuffix}:`,
      `• ${subscription.planName} plan: ${formatMoney(p.planPrice)}`,
      ...(target > 0 ? [`• ${plural(target)}: ${formatMoney(target * p.addonPrice)}`] : []),
    ].join("\n");

  const handleSave = async () => {
    if (!preview) return;
    const added = target - subscription.addonSlots;
    const prorated = preview.amountDueNow < preview.fullPeriodAmount - 0.005;
    const periodWord = interval === "yearly" ? "year" : "month";

    const message = keeping
      ? [
          `No charge now — you've already paid for these slots this period.`,
          `They'll keep renewing with your ${subscription.planName} plan.`,
          "",
          renewalBreakdown(preview),
        ].join("\n")
      : removing
      ? [
          `You keep all ${plural(subscription.addonSlots)} until ${formatDate(preview.effectiveAt)}. Nothing is refunded for this period.`,
          `Your ${subscription.planName} plan stays as it is.`,
          ...(overLimitAfter
            ? [
                `You have ${subscription.slotsUsed} companies connected, so on ${formatDate(preview.effectiveAt)} the ones with the fewest scans will be disconnected to fit ${limitAfter} slots.`,
              ]
            : []),
          "",
          renewalBreakdown(preview),
        ].join("\n")
      : [
          `${formatMoney(preview.amountDueNow)} will be charged now to ${cardLabel(preview.paymentMethod)}. No payment page opens.`,
          prorated
            ? `That covers the rest of your current billing period, until ${formatDate(preview.renewalDate)}.`
            : `That covers a full ${periodWord}, until ${formatDate(preview.renewalDate)}.`,
          `Your ${subscription.planName} plan stays as it is — this is charged on top of it.`,
          "",
          renewalBreakdown(preview),
        ].join("\n");

    const confirmed = await confirmDialog({
      title: keeping
        ? `Keep ${plural(target)}?`
        : removing
          ? `Reduce to ${plural(target)}?`
          : `Add ${plural(added)} for ${formatMoney(preview.amountDueNow)}?`,
      message,
      confirmLabel: keeping ? "Keep slots" : removing ? "Reduce slots" : `Pay ${formatMoney(preview.amountDueNow)}`,
      tone: removing ? "destructive" : "default",
    });
    if (!confirmed) return;

    setSaving(true);
    setLastCharge(null);
    try {
      const result = await dispatch(
        updateAddonSlots({ quantity: target, prorationDate: preview.prorationDate, expectedAmountDue: preview.amountDueNow }),
      );
      if (updateAddonSlots.fulfilled.match(result)) {
        showToast(result.payload.message, "success");
        setLastCharge(result.payload.charge);
      } else if (result.payload?.code === "PAYMENT_ACTION_REQUIRED" && result.payload.hostedInvoiceUrl) {
        const openInvoice = await confirmDialog({
          title: "Complete your payment",
          message: `${result.payload.message} Your bank needs you to confirm it on Stripe's payment page. The slots are added as soon as it's paid.`,
          confirmLabel: "Open payment page",
        });
        if (openInvoice) window.open(result.payload.hostedInvoiceUrl, "_blank", "noopener");
      } else {
        reportSaveError(result.payload);
      }
    } finally {
      setSaving(false);
      dispatch(fetchMySubscription({ force: true }));
    }
  };

  return (
    <div ref={cardRef} id="extra-slots">
      <h3 className="mb-[var(--space-md)] text-h3 font-bold text-trust-navy">Extra slots</h3>
      <div className="flex flex-col gap-[var(--space-md)] rounded-lg border border-border bg-surface p-[var(--space-md)]">
        <p className="text-body-sm text-text-secondary">
          Need more companies than your plan&apos;s {subscription.baseSlots}? Add slots for{" "}
          <span className="font-bold text-text-primary">
            {formatMoney(perSlot)}
            {intervalSuffix}
          </span>{" "}
          each. They renew and end with your plan.
        </p>

        <div className="grid grid-cols-2 gap-[var(--space-md)]">
          <div className="rounded-lg bg-background-soft p-[var(--space-sm)]">
            <p className="text-caption text-text-secondary">Plan slots</p>
            <p className="mt-1 text-body-sm font-bold text-text-primary">{subscription.baseSlots}</p>
          </div>
          <div className="rounded-lg bg-background-soft p-[var(--space-sm)]">
            <p className="text-caption text-text-secondary">Extra slots</p>
            <p className="mt-1 text-body-sm font-bold text-text-primary">{subscription.addonSlots}</p>
          </div>
        </div>

        {subscription.addonSlotsNext != null && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-[var(--space-md)] py-[var(--space-sm)]">
            <p className="text-body-sm text-text-secondary">
              Drops to <span className="font-bold text-text-primary">{plural(subscription.addonSlotsNext)}</span> on{" "}
              <span className="font-bold text-text-primary">{formatDate(subscription.addonSlotsNextAt)}</span>.
            </p>
          </div>
        )}

        {addon.purchasable ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-[var(--space-md)]">
              <div className="flex items-center gap-[var(--space-sm)]">
                <button
                  type="button"
                  aria-label="One fewer extra slot"
                  onClick={() => setTarget((n) => Math.max(0, n - 1))}
                  disabled={target <= 0 || saving}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-text-primary hover:bg-surface-alt disabled:opacity-40"
                >
                  <Minus size={18} strokeWidth={2.5} />
                </button>
                <span className="min-w-[3ch] text-center text-h3 font-bold text-text-primary" aria-live="polite">
                  {target}
                </span>
                <button
                  type="button"
                  aria-label="One more extra slot"
                  onClick={() => setTarget((n) => Math.min(maxExtra, n + 1))}
                  disabled={target >= maxExtra || saving}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-text-primary hover:bg-surface-alt disabled:opacity-40"
                >
                  <Plus size={18} strokeWidth={2.5} />
                </button>
              </div>
              <p className="text-caption text-text-secondary">
                Total: <span className="font-bold text-text-primary">{limitAfter} slots</span> (up to {maxExtra} extra)
              </p>
            </div>

            {changed && (
              <div className="rounded-lg bg-background-soft px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
                {removalBlocksPurchase ? (
                  <div className="flex flex-col gap-[var(--space-sm)]">
                    <span>
                      You&apos;ve scheduled a removal. Keep your {plural(subscription.addonSlots)} first (no charge),
                      then add more.
                    </span>
                    <button
                      type="button"
                      onClick={handleKeepSlots}
                      disabled={saving}
                      className="self-start rounded-lg border border-primary px-[var(--space-md)] py-[var(--space-xs)] font-semibold text-primary disabled:opacity-60"
                    >
                      {saving ? <Spinner size="sm" /> : `Keep my ${plural(subscription.addonSlots)}`}
                    </button>
                  </div>
                ) : previewError ? (
                  <div className="flex flex-col gap-[var(--space-sm)]">
                    <span className="text-status-danger-text">{previewError.message}</span>
                    <div className="flex flex-wrap gap-[var(--space-sm)]">
                      {previewError.hostedInvoiceUrl && (
                        <a
                          href={previewError.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg bg-primary px-[var(--space-md)] py-[var(--space-xs)] font-semibold text-white"
                        >
                          Complete payment
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewAttempt((n) => n + 1)}
                        className="rounded-lg border border-border px-[var(--space-md)] py-[var(--space-xs)] font-semibold text-text-primary hover:bg-surface-alt"
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                ) : previewing || !preview ? (
                  <span className="flex items-center gap-[var(--space-sm)]">
                    <Spinner size="sm" /> Working out the price…
                  </span>
                ) : keeping ? (
                  <>
                    No charge — already paid for this period. From {formatDate(preview.renewalDate)}:{" "}
                    <span className="font-bold text-text-primary">
                      {formatMoney(preview.renewalAmount)}
                      {intervalSuffix}
                    </span>
                    .
                  </>
                ) : removing ? (
                  <>
                    No charge now. You keep your current slots until{" "}
                    <span className="font-bold text-text-primary">{formatDate(preview.effectiveAt)}</span>, then pay{" "}
                    <span className="font-bold text-text-primary">
                      {formatMoney(preview.renewalAmount)}
                      {intervalSuffix}
                    </span>
                    .
                  </>
                ) : (
                  <div className="flex flex-col gap-1">
                    <span>
                      Charged now: <span className="font-bold text-text-primary">{formatMoney(preview.amountDueNow)}</span>{" "}
                      to {cardLabel(preview.paymentMethod)}
                      {preview.amountDueNow < preview.fullPeriodAmount - 0.005 && " (rest of this billing period)"}.
                    </span>
                    <span>
                      From {formatDate(preview.renewalDate)}:{" "}
                      <span className="font-bold text-text-primary">
                        {formatMoney(preview.renewalAmount)}
                        {intervalSuffix}
                      </span>{" "}
                      ({formatMoney(preview.planPrice)} plan + {formatMoney(target * preview.addonPrice)} for {plural(target)}).
                    </span>
                  </div>
                )}
              </div>
            )}

            {changed && !removalBlocksPurchase && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!preview || previewing || saving}
                className="flex items-center justify-center gap-[var(--space-sm)] rounded-lg bg-primary px-[var(--space-md)] py-[var(--space-sm)] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving ? <Spinner size="sm" /> : keeping ? "Keep extra slots" : removing ? "Reduce extra slots" : "Review & pay"}
              </button>
            )}

            {lastCharge && (
              <p className="rounded-lg border border-success/30 bg-success/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
                Paid <span className="font-bold text-text-primary">{formatMoney(lastCharge.amount)}</span> with{" "}
                {cardLabel(lastCharge.paymentMethod)}.
                {lastCharge.receiptUrl && (
                  <>
                    {" "}
                    <a href={lastCharge.receiptUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
                      View receipt
                    </a>
                  </>
                )}
              </p>
            )}

            {billedNext > 0 && (
              <p className="text-caption text-text-secondary">
                While you have extra slots, your plan can&apos;t be switched from Manage billing. Set extra slots to 0
                first — you keep them until the period ends.
              </p>
            )}
          </>
        ) : (
          <p className="text-body-sm text-text-secondary">
            {subscription.status !== "active"
              ? "Extra slots can be added while your plan is active."
              : subscription.provider === "apple" || subscription.provider === "google"
                ? "Your plan is billed through the app store — extra slots can only be added to a plan bought on the web."
                : "Contact support to add extra slots to your plan."}
          </p>
        )}
      </div>
    </div>
  );
}
