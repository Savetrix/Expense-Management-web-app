"use client";

import Link from "next/link";
import { ArrowRight, Lock, Settings, Check } from "lucide-react";
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

const PLAN_FEATURES: Record<string, string[]> = {
  trial: [
    "Unlimited scans during trial",
    "Unlimited team members",
    "1 QuickBooks slot",
  ],
  standard: [
    "Unlimited scans & automated push",
    "Unlimited team members",
    "1 QuickBooks or Xero slot",
    "Automated GL codes & tax rules",
    "High-speed OCR (99.2% accuracy)",
    "Multi-currency CAD & USD support",
  ],
  enterprise: [
    "Unlimited entity consolidated view",
    "Unlimited QuickBooks / Xero slots",
    "Claude MCP & Custom ERP API sync",
    "Custom audit logs & role permissions",
    "Dedicated CPA support & onboarding",
  ],
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SubscriptionStatusContentV2() {
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

  useEffect(() => {
    const checkoutStatus = searchParams.get("checkout");
    const sessionId = searchParams.get("session_id");

    if (checkoutStatus === "success" && sessionId) {
      dispatch(confirmCheckout(sessionId)).then((result) => {
        dispatch(fetchMySubscription());
        if (confirmCheckout.fulfilled.match(result)) {
          showToast("Subscription confirmed — you're all set!", "success");
        } else {
          const payload = result.payload as { message?: string } | undefined;
          showToast(
            payload?.message || "Payment received — confirming your subscription is taking a little longer than usual. Refresh in a moment.",
            "error"
          );
        }
      });
      router.replace("/v2/subscription");
    } else if (checkoutStatus === "cancelled") {
      router.replace("/v2/subscription");
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
      <div className="mx-auto max-w-3xl p-[var(--space-lg)]">
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
  const planFeatures = PLAN_FEATURES[subscription.plan] || [];

  return (
    <div className="mx-auto max-w-3xl p-[var(--space-lg)]">
      <div className="flex flex-col gap-[var(--space-lg)]">
        {/* Hero: Current Plan Overview */}
        <div>
          <h1 className="mb-[var(--space-md)] text-h2 font-bold text-trust-navy">Your Subscription</h1>
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-[var(--space-lg)]">
            <div className="flex flex-col gap-[var(--space-md)]">
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-md)]">
                <div>
                  <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">Current plan</p>
                  <h2 className="mt-[var(--space-xs)] text-h2 font-bold text-trust-navy">{subscription.planName}</h2>
                </div>
                <span className={`flex shrink-0 items-center gap-[var(--space-xs)] rounded-full px-[var(--space-md)] py-[var(--space-xs)] text-caption font-bold ${statusMeta.className}`}>
                  <span className="h-2 w-2 rounded-full bg-current" />
                  {statusMeta.label}
                </span>
              </div>

              {/* Plan Details Grid */}
              <div className="grid grid-cols-2 gap-[var(--space-md)] sm:grid-cols-3">
                <div className="rounded-lg bg-surface/60 p-[var(--space-sm)]">
                  <p className="text-caption text-text-secondary">Billing</p>
                  <p className="mt-1 text-body-sm font-bold text-text-primary">{billingLabel}</p>
                </div>
                <div className="rounded-lg bg-surface/60 p-[var(--space-sm)]">
                  <p className="text-caption text-text-secondary">
                    {subscription.plan === "trial" ? "Trial ends" : "Next billing"}
                  </p>
                  <p className="mt-1 text-body-sm font-bold text-text-primary">
                    {formatDate(subscription.plan === "trial" ? subscription.trialEndsAt : subscription.currentPeriod?.end)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface/60 p-[var(--space-sm)]">
                  <p className="text-caption text-text-secondary">QB slots</p>
                  <p className="mt-1 text-body-sm font-bold text-text-primary">
                    {subscription.slotsUsed}/{subscription.maxSlots}
                  </p>
                </div>
              </div>

              {subscription.downgradeAvailableAt && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 px-[var(--space-md)] py-[var(--space-sm)]">
                  <p className="text-body-sm text-text-secondary">
                    Downgrade available on <span className="font-bold text-text-primary">{formatDate(subscription.downgradeAvailableAt)}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Plan Features */}
        {planFeatures.length > 0 && (
          <div>
            <h3 className="mb-[var(--space-md)] text-h3 font-bold text-trust-navy">Plan features</h3>
            <div className="flex flex-wrap gap-[var(--space-sm)]">
              {planFeatures.map((feature) => (
                <div key={feature} className="flex flex-1 min-w-[200px] gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)]">
                  <Check size={20} strokeWidth={2.5} className="shrink-0 text-success" />
                  <span className="text-body-sm text-text-primary">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connected Companies */}
        {subscription.slots.length > 0 && (
          <div>
            <h3 className="mb-[var(--space-md)] text-h3 font-bold text-trust-navy">Connected companies</h3>
            <div className="flex flex-col gap-[var(--space-sm)]">
              {subscription.slots.map((slot) => (
                <div
                  key={slot.qbConnectionId}
                  className="flex flex-wrap items-start justify-between gap-[var(--space-md)] rounded-lg border border-border bg-surface p-[var(--space-md)]"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary">{slot.name}</p>
                    <p className="text-caption text-text-secondary">Realm ID: {slot.realmId}</p>
                  </div>
                  {slot.locked && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-warning">
                      <Lock size={12} strokeWidth={2.5} />
                      Locked until {formatDate(slot.unlockAt)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-[var(--space-sm)]">
          <Link
            href="/v2/plans"
            className="flex items-center justify-center gap-[var(--space-sm)] rounded-lg bg-primary px-[var(--space-md)] py-[var(--space-md)] font-semibold text-white transition-opacity hover:opacity-90"
          >
            View all plans <ArrowRight size={18} strokeWidth={2} />
          </Link>
          {subscription.provider === "stripe" && (
            <button
              type="button"
              onClick={handleManageSubscription}
              disabled={openingPortal}
              className="flex items-center justify-center gap-[var(--space-sm)] rounded-lg border border-border bg-surface px-[var(--space-md)] py-[var(--space-md)] font-semibold text-text-primary transition-opacity hover:bg-surface-alt disabled:opacity-60"
            >
              {openingPortal ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <Settings size={18} strokeWidth={2} />
                  Manage billing
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
