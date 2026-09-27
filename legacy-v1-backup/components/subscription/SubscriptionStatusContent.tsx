"use client";

import Link from "next/link";
import { ArrowRight, Lock, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import { showToast } from "@/lib/dialogManager";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMySubscription, openBillingPortal, confirmCheckout } from "@/store/subscription/subscriptionApi";

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-success/10 text-success" },
  trialing: { label: "Trial", className: "bg-primary/10 text-primary" },
  past_due: { label: "Past Due", className: "bg-warning/10 text-warning" },
  canceled: { label: "Canceled", className: "bg-background-alt text-text-secondary" },
  expired: { label: "Expired", className: "bg-error/10 text-error" },
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SubscriptionStatusContent() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subscription = useAppSelector((state) => state.subscription.subscription);
  const loading = useAppSelector((state) => state.subscription.subscriptionLoading);
  const error = useAppSelector((state) => state.subscription.subscriptionError);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    dispatch(fetchMySubscription());
  }, [dispatch]);

  // Landing back here from Stripe Checkout (success_url includes these query
  // params — see stripe.service.js createCheckoutSession). Confirm the
  // session immediately instead of waiting on the async webhook, same
  // pattern as the mobile app's /subscription/sync after a RevenueCat
  // purchase, then strip the params so a page refresh doesn't re-confirm.
  useEffect(() => {
    const checkoutStatus = searchParams.get("checkout");
    const sessionId = searchParams.get("session_id");

    if (checkoutStatus === "success" && sessionId) {
      dispatch(confirmCheckout(sessionId)).then((result) => {
        dispatch(fetchMySubscription());
        if (confirmCheckout.fulfilled.match(result)) {
          showToast("Subscription confirmed — you're all set!", "success");
        } else {
          // Payment likely succeeded on Stripe's side even if this immediate
          // confirm call failed (network blip, etc.) — the webhook is the
          // durable path and will still activate it shortly. Don't leave the
          // user with zero feedback after they just paid.
          const payload = result.payload as { message?: string } | undefined;
          showToast(
            payload?.message || "Payment received — confirming your subscription is taking a little longer than usual. Refresh in a moment.",
            "error"
          );
        }
      });
      router.replace("/subscription");
    } else if (checkoutStatus === "cancelled") {
      router.replace("/subscription");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleManageSubscription = async () => {
    setOpeningPortal(true);
    try {
      const result = await dispatch(openBillingPortal());
      if (openBillingPortal.fulfilled.match(result)) {
        window.location.href = result.payload.data.url;
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not open billing portal. Please try again.", "error");
      }
    } finally {
      setOpeningPortal(false);
    }
  };

  if (loading && !subscription) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error && !subscription) {
    return (
      <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
        <ErrorState message={error} onRetry={() => dispatch(fetchMySubscription())} />
      </div>
    );
  }

  if (!subscription) return null;

  const statusMeta = STATUS_META[subscription.status] ?? { label: subscription.status, className: "bg-background-alt text-text-secondary" };
  const billingLabel =
    subscription.plan === "trial"
      ? "Free trial"
      : `${subscription.billingInterval === "yearly" ? "Yearly" : "Monthly"} billing`;

  return (
    <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
      <h1 className="text-h2 font-bold text-trust-navy">Subscription</h1>

      <div className="mt-[var(--space-lg)] rounded-xl border border-border bg-white p-[var(--space-md)]">
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
          <div className="min-w-0">
            <p className="text-caption text-text-secondary">Current plan</p>
            <p className="mt-[var(--space-xs)] break-words text-h1 font-bold text-trust-navy">{subscription.planName}</p>
          </div>
          <span className={`flex shrink-0 items-center gap-[var(--space-xs)] rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] ${statusMeta.className}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span className="text-caption font-bold">{statusMeta.label}</span>
          </span>
        </div>

        <div className="my-[var(--space-md)] h-px bg-border" />

        <div className="flex items-center justify-between py-[var(--space-xs)]">
          <span className="text-body-sm text-text-secondary">Billing</span>
          <span className="text-body-sm font-bold text-text-primary">{billingLabel}</span>
        </div>
        <div className="flex items-center justify-between py-[var(--space-xs)]">
          <span className="text-body-sm text-text-secondary">
            {subscription.plan === "trial" ? "Trial ends" : "Next billing date"}
          </span>
          <span className="text-body-sm font-bold text-text-primary">
            {formatDate(subscription.plan === "trial" ? subscription.trialEndsAt : subscription.currentPeriod?.end)}
          </span>
        </div>
        <div className="flex items-center justify-between py-[var(--space-xs)]">
          <span className="text-body-sm text-text-secondary">QuickBooks slots</span>
          <span className="text-body-sm font-bold text-text-primary">
            {subscription.slotsUsed} of {subscription.maxSlots} slots used
          </span>
        </div>
        {subscription.downgradeAvailableAt && (
          <div className="flex items-center justify-between py-[var(--space-xs)]">
            <span className="text-body-sm text-text-secondary">Downgrade available</span>
            <span className="text-body-sm font-bold text-text-primary">{formatDate(subscription.downgradeAvailableAt)}</span>
          </div>
        )}
      </div>

      {subscription.slots.length > 0 && (
        <>
          <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-text-secondary">
            Connected companies
          </p>
          <div className="flex flex-col gap-[var(--space-xs)]">
            {subscription.slots.map((slot) => (
              <div
                key={slot.qbConnectionId}
                className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-lg border border-border bg-white px-[var(--space-md)] py-[var(--space-sm)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text-primary">{slot.name}</p>
                  <p className="text-caption text-text-secondary">Realm ID: {slot.realmId}</p>
                </div>
                {slot.locked && (
                  <span className="flex shrink-0 items-center gap-1 rounded-pill bg-warning/10 px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-warning">
                    <Lock size={12} strokeWidth={2.5} />
                    Locked until {formatDate(slot.unlockAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <Link
        href="/plans"
        className="mt-[var(--space-lg)] flex items-center justify-center gap-[var(--space-xs)] rounded-lg bg-primary py-[var(--space-sm)] font-bold text-white"
      >
        Change Plan <ArrowRight size={16} strokeWidth={2.25} />
      </Link>

      {subscription.provider === "stripe" && (
        <button
          type="button"
          onClick={handleManageSubscription}
          disabled={openingPortal}
          className="mt-[var(--space-sm)] flex w-full items-center justify-center gap-[var(--space-xs)] rounded-lg border border-border bg-white py-[var(--space-sm)] font-bold text-text-primary disabled:opacity-60"
        >
          {openingPortal ? (
            <Spinner size="sm" />
          ) : (
            <>
              <Settings size={16} strokeWidth={2.25} />
              Manage Subscription
            </>
          )}
        </button>
      )}
    </div>
  );
}
