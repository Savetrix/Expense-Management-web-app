"use client";

import Link from "next/link";
import { CreditCard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { showToast } from "@/lib/dialogManager";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { Modal } from "@/components/v2/ui/Modal";
import { TextInput } from "@/components/v2/ui/TextInput";
import { SelectDropdown } from "@/components/v2/ui/SelectDropdown";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPlans } from "@/store/subscription/subscriptionApi";
import {
  confirmTeamCheckout,
  fetchTeamBilling,
  startTeamCheckout,
  type BillingInterval,
  type PaidPlanKey,
  type TeamBilling,
} from "@/store/quickBooks/teamBillingApi";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const money = (amount: number) => `$${amount.toFixed(2)}`;

const STATUS_META: Record<TeamBilling["status"], { label: string; className: string }> = {
  active: { label: "Active", className: "bg-success/10 text-success" },
  trialing: { label: "Trial", className: "bg-primary/10 text-primary" },
  past_due: { label: "Past due", className: "bg-warning/10 text-warning" },
  canceled: { label: "Canceled", className: "bg-background-alt text-text-secondary" },
  expired: { label: "Expired", className: "bg-error/10 text-error" },
};

interface PayForm {
  plan: PaidPlanKey;
  billingInterval: BillingInterval;
  addonSlots: string;
  couponCode: string;
}

interface TeamBillingCardProps {
  connection: { _id: string; name: string; role?: string };
  /** Changes after a payment is confirmed — reloads the owner's plan. */
  refreshKey?: number;
}

// Team page › Plan & billing. The plan of a company is its OWNER's (one plan
// covers every company they own). The owner manages it on their Subscription
// page; an admin of the company sees it here and can pay for it with their
// own card (Scantrix_API stripe.service.js createMemberCheckoutSession) — it
// then renews on that card until the owner changes it or cancels.
// Accountants and contributors see nothing.
// Back from Stripe Checkout (?company=<the company paid through>&checkout=…).
// Mounted on the Team page whatever is selected — even no company — and
// confirms against the company paid through. onConfirmed lets the page reload
// the card. The toast follows the server: done, still processing, or refused.
export function TeamCheckoutReturn({ onConfirmed }: { onConfirmed: () => void }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const checkoutStatus = searchParams.get("checkout");
    const company = searchParams.get("company");
    const sessionId = searchParams.get("session_id");
    if (!checkoutStatus || !company) return;
    router.replace("/team");
    if (checkoutStatus === "cancelled") {
      showToast("Payment cancelled. Nothing was charged.", "info");
      return;
    }
    if (checkoutStatus !== "success" || !sessionId) return;
    // A revisit of this exact URL (back/forward, refresh) mustn't re-confirm.
    const confirmedKey = `team_checkout_confirmed_${sessionId}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(confirmedKey) === "1") return;
    if (typeof window !== "undefined") sessionStorage.setItem(confirmedKey, "1");

    dispatch(confirmTeamCheckout({ qbId: company, sessionId })).then((result) => {
      if (confirmTeamCheckout.fulfilled.match(result)) {
        const { billing, processing, message } = result.payload;
        if (processing) showToast(message, "info");
        else showToast(`Payment done. ${billing.owner.name ?? "The owner"}'s plan is active.`, "success");
      } else {
        showToast(result.payload?.message || "Payment received. The plan will show here in a moment — refresh shortly.", "error");
      }
      onConfirmed();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return null;
}

export function TeamBillingCardV2({ connection, refreshKey = 0 }: TeamBillingCardProps) {
  const role = connection.role;
  if (role === "owner") {
    return (
      <Section>
        <p className="text-body-sm text-text-secondary">
          Your plan covers <strong className="font-semibold text-text-primary">{connection.name}</strong> and your other
          companies.
        </p>
        <Link href="/subscription" className="mt-[var(--space-sm)] inline-block text-body-sm font-semibold text-primary hover:underline">
          Manage it on the Subscription page
        </Link>
      </Section>
    );
  }
  if (role !== "admin") return null;
  // Keyed by company (switching companies starts from a clean card) and by
  // the last confirm (reloads the owner's plan).
  return <AdminBilling key={`${connection._id}-${refreshKey}`} qbId={connection._id} />;
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-text-secondary">
        Plan &amp; billing
      </p>
      <div className="rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">{children}</div>
    </>
  );
}

function AdminBilling({ qbId }: { qbId: string }) {
  const dispatch = useAppDispatch();
  const plans = useAppSelector((state) => state.subscription.plans);

  const [billing, setBilling] = useState<TeamBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [form, setForm] = useState<PayForm>({ plan: "standard", billingInterval: "monthly", addonSlots: "0", couponCode: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const result = await dispatch(fetchTeamBilling(qbId));
    if (fetchTeamBilling.fulfilled.match(result)) setBilling(result.payload);
    else setError(result.payload?.message ?? "Could not load the owner's plan");
  }, [dispatch, qbId]);

  useEffect(() => {
    load();
    dispatch(fetchPlans());
  }, [load, dispatch]);

  if (error) {
    return (
      <Section>
        <ErrorState message={error} onRetry={load} />
      </Section>
    );
  }
  if (!billing) {
    return (
      <Section>
        <div className="flex justify-center py-[var(--space-sm)]">
          <Spinner size="sm" />
        </div>
      </Section>
    );
  }

  const ownerName = billing.owner.name || billing.owner.email || "The owner";
  const status = STATUS_META[billing.status] ?? { label: billing.status, className: "bg-background-alt text-text-secondary" };
  const live = billing.status === "active" || billing.status === "past_due";

  const update = (patch: Partial<PayForm>) => setForm((f) => ({ ...f, ...patch }));
  const planEntry = plans.find((p) => p.key === form.plan);
  const addon = planEntry?.addon ?? null;
  const slots = addon ? Number(form.addonSlots) || 0 : 0;
  const price = planEntry?.prices ? planEntry.prices[form.billingInterval] + slots * (addon?.prices[form.billingInterval] ?? 0) : null;
  const periodWord = form.billingInterval === "yearly" ? "year" : "month";
  // Fewer slots than the owner's connected companies disconnects the extra
  // ones once paid (the backend keeps the most-used).
  const slotsAfter = planEntry ? planEntry.maxSlots + slots : null;
  const overBy = slotsAfter != null ? billing.slotsUsed - slotsAfter : 0;

  const openPay = () => {
    setFormError(null);
    setForm({
      plan: billing.plan === "trial" ? "standard" : billing.plan,
      billingInterval: billing.billingInterval ?? "monthly",
      addonSlots: "0",
      couponCode: "",
    });
    setPayOpen(true);
  };

  const handlePay = async () => {
    if (addon && !(Number.isInteger(slots) && slots >= 0 && slots <= addon.maxSlots)) {
      return setFormError(`Extra slots must be a whole number from 0 to ${addon.maxSlots}.`);
    }
    setFormError(null);
    setStarting(true);
    try {
      const result = await dispatch(
        startTeamCheckout({
          qbId,
          plan: form.plan,
          billingInterval: form.billingInterval,
          ...(slots > 0 && { addonSlots: slots }),
          ...(form.couponCode.trim() && { couponCode: form.couponCode.trim() }),
        }),
      );
      if (startTeamCheckout.fulfilled.match(result)) {
        window.location.href = result.payload;
        return;
      }
      setFormError(result.payload?.message ?? "Could not start the payment.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Section>
      <div className="flex items-start justify-between gap-[var(--space-sm)]">
        <div className="min-w-0">
          <p className="text-caption text-text-secondary">{ownerName}&apos;s plan</p>
          <p className="font-bold text-text-primary">
            {billing.planName}
            {billing.billingInterval && billing.plan !== "trial" && (
              <span className="font-normal text-text-secondary"> · {billing.billingInterval}</span>
            )}
          </p>
        </div>
        <span className={`shrink-0 rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold ${status.className}`}>
          {status.label}
        </span>
      </div>

      <dl className="mt-[var(--space-sm)] grid grid-cols-2 gap-[var(--space-xs)] text-body-sm">
        <dt className="text-text-secondary">{billing.plan === "trial" ? "Trial ends" : "Renews"}</dt>
        <dd className="text-right text-text-primary">
          {formatDate(billing.plan === "trial" ? billing.trialEndsAt : live ? billing.currentPeriodEnd : null)}
        </dd>
        <dt className="text-text-secondary">Companies</dt>
        <dd className="text-right text-text-primary">
          {billing.slotsUsed}/{billing.maxSlots}
        </dd>
      </dl>

      {billing.paidBy && (
        <p className="mt-[var(--space-sm)] text-caption text-text-secondary">
          Bought by {billing.paidBy.isYou ? "you" : billing.paidBy.name}. It renews on that card until {ownerName} changes it.
        </p>
      )}

      {billing.canPay ? (
        <Button size="sm" className="mt-[var(--space-md)] w-full" onClick={openPay}>
          <CreditCard size={16} strokeWidth={2.25} />
          Pay for {ownerName}&apos;s plan
        </Button>
      ) : (
        !billing.paidBy && <p className="mt-[var(--space-sm)] text-caption text-text-secondary">{ownerName} already pays for this plan.</p>
      )}

      <Modal
        open={payOpen}
        onClose={() => !starting && setPayOpen(false)}
        title={`Pay for ${ownerName}'s plan`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setPayOpen(false)}
              disabled={starting}
              className="rounded-lg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-content-secondary hover:bg-surface-alt"
            >
              Cancel
            </button>
            <Button size="sm" onClick={handlePay} loading={starting}>
              Continue to payment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--space-md)]">
          <SelectDropdown label="Plan" value={form.plan} onChange={(event) => update({ plan: event.target.value as PaidPlanKey })}>
            <option value="standard">Standard</option>
            <option value="enterprise">Enterprise</option>
          </SelectDropdown>
          <SelectDropdown
            label="Billing"
            value={form.billingInterval}
            onChange={(event) => update({ billingInterval: event.target.value as BillingInterval })}
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </SelectDropdown>
          {addon && (
            <TextInput
              label={`Extra slots (0–${addon.maxSlots}, ${money(addon.prices[form.billingInterval])} each)`}
              type="number"
              min={0}
              max={addon.maxSlots}
              value={form.addonSlots}
              onChange={(event) => update({ addonSlots: event.target.value })}
            />
          )}
          <TextInput
            label="Coupon code (optional)"
            placeholder="SAVE5"
            value={form.couponCode}
            onChange={(event) => update({ couponCode: event.target.value.toUpperCase() })}
          />

          <p className="rounded-lg bg-background-soft px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
            {price != null && (
              <>
                You pay <span className="font-bold text-text-primary">{money(price)}</span>/{periodWord}
                {form.couponCode.trim() ? " before the coupon" : ""} for {planEntry?.name}
                {slots > 0 ? ` with ${slots} extra slot${slots === 1 ? "" : "s"}` : ""}.{" "}
              </>
            )}
            The plan covers all of {ownerName}&apos;s companies and renews every {periodWord} on your card until{" "}
            {ownerName} changes the card or cancels from their Subscription page. Stripe&apos;s payment page shows the final
            amount.
          </p>
          {overBy > 0 && slotsAfter != null && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
              {ownerName} has {billing.slotsUsed} connected companies and this plan allows {slotsAfter}. Once paid, {overBy}{" "}
              {overBy === 1 ? "company is" : "companies are"} disconnected (the ones with the fewest invoices).
            </p>
          )}
          {formError && <p className="text-body-sm text-status-danger-text">{formError}</p>}
        </div>
      </Modal>
    </Section>
  );
}
