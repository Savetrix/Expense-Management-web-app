"use client";

import Link from "next/link";
import { Check, ChevronRight, Eye, ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { showToast } from "@/lib/dialogManager";
import { Spinner } from "@/components/ui/Spinner";
import { CustomPlanEnquiryModal } from "@/components/subscription/CustomPlanEnquiryModal";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPlans,
  fetchMySubscription,
  startCheckout,
  openBillingPortal,
  type SubscriptionPlanKey,
} from "@/store/subscription/subscriptionApi";

type BillingCycle = "monthly" | "yearly";

// Presentation-only metadata the backend catalog doesn't carry — pricing/
// maxSlots always come from the live GET /subscription/plans response,
// keyed here by plan id. Mirrors PLAN_META in the original PlansContent,
// expanded with the fuller feature list + note copy this layout has room for.
const PLAN_META: Record<
  string,
  { tagline: string; features: string[]; priceNote: string; highlight?: boolean; staticBadge?: string }
> = {
  trial: {
    tagline: "Test Scantrix risk-free for your firm",
    features: [
      "Unlimited scans during trial",
      "Unlimited team members",
      "1 QuickBooks connection slot",
      "Standard OCR text parsing",
      "Email inbox intake",
    ],
    priceNote: "No credit card required upfront",
  },
  standard: {
    tagline: "For growing accounting teams & businesses",
    features: [
      "Unlimited scans & automated push",
      "Unlimited team members",
      "1 QuickBooks or Xero live slot",
      "Automated GL codes & tax rules",
      "High-speed OCR (99.2% accuracy)",
      "Multi-currency CAD & USD support",
    ],
    priceNote: "Billed monthly, cancel anytime",
    highlight: true,
  },
  enterprise: {
    tagline: "For multi-entity firms & franchises",
    features: [
      "Unlimited entity consolidated view",
      "Unlimited QuickBooks / Xero slots",
      "Claude MCP & Custom ERP API sync",
      "Custom audit logs & role permissions",
      "Dedicated CPA support & onboarding",
    ],
    priceNote: "Multi-entity discounts available",
    staticBadge: "SCALE",
  },
};

function priceLabel(planKey: string, prices: { monthly: number; yearly: number } | null, cycle: BillingCycle) {
  if (planKey === "trial" || !prices) return "Free";
  return `$${cycle === "monthly" ? prices.monthly : prices.yearly}`;
}

function priceSuffix(planKey: string, cycle: BillingCycle) {
  if (planKey === "trial") return "/ 14 days";
  return cycle === "monthly" ? "/ month" : "/ year";
}

function daysRemaining(value: string | null | undefined) {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export function PlansContentV2() {
  const dispatch = useAppDispatch();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const [enquiryOpen, setEnquiryOpen] = useState(false);

  const user = useAppSelector((state) => state.auth.user);
  const plans = useAppSelector((state) => state.subscription.plans);
  const plansLoading = useAppSelector((state) => state.subscription.plansLoading);
  const subscription = useAppSelector((state) => state.subscription.subscription);
  const subscriptionLoading = useAppSelector((state) => state.subscription.subscriptionLoading);

  useEffect(() => {
    dispatch(fetchPlans());
    dispatch(fetchMySubscription());
  }, [dispatch]);

  // Real payment via Stripe. No "are you sure" dialog here — Stripe's own
  // hosted Checkout page is the confirmation step. If the user already has
  // an active Stripe subscription, a NEW Checkout Session would create a
  // second, separate subscription rather than changing the existing one —
  // so plan switches for an existing Stripe subscriber go through the
  // Billing Portal instead, which updates the existing subscription in place.
  const handleChoosePlan = async (planKey: SubscriptionPlanKey, planName: string) => {
    if (subscriptionLoading) return;
    setSwitchingKey(`${planKey}-${cycle}`);
    try {
      if (subscription?.provider === "stripe") {
        const result = await dispatch(openBillingPortal());
        if (openBillingPortal.fulfilled.match(result)) {
          window.location.href = result.payload.data.url;
        } else {
          const payload = result.payload as { message?: string } | undefined;
          showToast(payload?.message || "Could not open billing portal. Please try again.", "error");
        }
        return;
      }

      const result = await dispatch(startCheckout({ plan: planKey, billingInterval: cycle }));
      if (startCheckout.fulfilled.match(result)) {
        window.location.href = result.payload.data.url;
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || `Could not start checkout for ${planName}. Please try again.`, "error");
      }
    } finally {
      setSwitchingKey(null);
    }
  };

  const currentPlanName = subscription?.planName ?? (subscriptionLoading ? "Loading…" : "—");
  const trialDaysLeft = subscription?.plan === "trial" ? daysRemaining(subscription.trialEndsAt) : null;
  const statusLabel =
    subscription?.status === "trialing"
      ? "Active Trial"
      : subscription?.status === "active"
        ? "Active Subscription"
        : subscription?.status === "past_due"
          ? "Past Due"
          : subscription?.status === "canceled"
            ? "Canceled"
            : subscription?.status === "expired"
              ? "Expired"
              : null;

  // Prefill from the signed-in account. Same `user?.data?.user` shape the
  // profile screens read (src/components/profile/ProfileContent.tsx) — this
  // page is behind AuthGate, so somebody is always signed in here. Purely a
  // convenience: the server never trusts any of it.
  const apiUser = user?.data?.user;
  const enquiryName = [apiUser?.firstName, apiUser?.lastName].filter(Boolean).join(" ");
  const enquiryEmail = typeof apiUser?.email === "string" ? apiUser.email : "";

  return (
    <div className="mx-auto max-w-6xl p-[var(--space-lg)]">
      <div className="text-center">
        <h1 className="text-h1 font-bold text-trust-navy">Choose your plan</h1>
        <p className="mx-auto mt-[var(--space-sm)] max-w-xl text-body-sm text-text-secondary">
          Select the ideal tier for your bookkeeping practice, automated reconciliation, and live ERP synchronizations.
        </p>
      </div>

      {subscription && (
        <div className="mx-auto mt-[var(--space-lg)] flex w-fit max-w-full flex-wrap items-center justify-center gap-[var(--space-sm)] rounded-lg border border-border bg-background-soft px-[var(--space-md)] py-[var(--space-sm)]">
          {statusLabel && (
            <span className="flex shrink-0 items-center gap-[var(--space-xs)] rounded-pill bg-success/10 px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {statusLabel}
            </span>
          )}
          <span className="text-body-sm text-text-secondary">
            Current plan: <strong className="font-bold text-trust-navy">{currentPlanName}</strong>
            {trialDaysLeft !== null && <> ({trialDaysLeft} days remaining)</>}
          </span>
          <span className="hidden text-border sm:inline">|</span>
          <Link
            href="/v2/subscription"
            className="flex shrink-0 items-center gap-[var(--space-xs)] text-caption font-bold text-primary"
          >
            View usage details <ChevronRight size={14} strokeWidth={2.25} />
          </Link>
        </div>
      )}

      <div className="mx-auto mt-[var(--space-lg)] flex w-fit rounded-pill bg-background-soft p-1">
        {(["monthly", "yearly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCycle(option)}
            className={`flex items-center gap-[var(--space-xs)] rounded-pill px-[var(--space-lg)] py-[var(--space-sm)] text-body-sm font-bold capitalize ${
              cycle === option ? "bg-primary text-white" : "text-text-secondary"
            }`}
          >
            {option}
            {option === "yearly" && (
              <span
                className={`rounded-pill px-[var(--space-xs)] py-0.5 text-[10px] font-bold ${
                  cycle === "yearly" ? "bg-white/20 text-white" : "bg-success/15 text-success"
                }`}
              >
                Save 20%
              </span>
            )}
          </button>
        ))}
      </div>

      {plansLoading ? (
        <div className="flex justify-center py-[var(--space-xl)]">
          <Spinner size="md" />
        </div>
      ) : (
        <>
          <div className="mt-[var(--space-xl)] grid gap-[var(--space-lg)] md:grid-cols-3">
            {plans.map((plan) => {
              const meta = PLAN_META[plan.key] ?? { tagline: "", features: [], priceNote: "" };
              const isPaid = plan.key !== "trial";
              const isCurrent =
                subscription?.status !== "expired" &&
                subscription?.plan === plan.key &&
                (!isPaid || subscription?.billingInterval === cycle);
              const isSwitching = switchingKey === `${plan.key}-${cycle}`;
              const topRightBadge = isCurrent
                ? { label: "Active", className: "bg-success/10 text-success" }
                : meta.staticBadge
                  ? { label: meta.staticBadge, className: "border border-border bg-background-soft text-text-secondary" }
                  : null;

              return (
                <div
                  key={plan.key}
                  className={`relative flex flex-col rounded-xl border bg-surface p-[var(--space-lg)] ${
                    meta.highlight ? "border-2 border-primary shadow-lg" : "border-border"
                  }`}
                >
                  {meta.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-pill bg-primary px-[var(--space-md)] py-1 text-caption font-bold tracking-wide text-white">
                      MOST POPULAR
                    </span>
                  )}

                  <div className="flex items-start justify-between gap-[var(--space-sm)]">
                    <p className="text-h3 font-bold text-text-primary">{plan.name}</p>
                    {topRightBadge && (
                      <span className={`shrink-0 rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold ${topRightBadge.className}`}>
                        {topRightBadge.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-[var(--space-xs)] text-caption text-text-secondary">{meta.tagline}</p>

                  <div className="mt-[var(--space-md)] flex items-end gap-1">
                    <span className="text-h1 font-bold text-text-primary">{priceLabel(plan.key, plan.prices, cycle)}</span>
                    <span className="mb-1 text-body-sm text-text-secondary">{priceSuffix(plan.key, cycle)}</span>
                  </div>
                  <p className="mt-[var(--space-xs)] text-caption text-text-secondary">
                    {isPaid && cycle === "yearly" && plan.prices ? (
                      <span className="font-semibold text-success">~17% off billed yearly</span>
                    ) : (
                      meta.priceNote
                    )}
                  </p>

                  <div className="my-[var(--space-md)] h-px bg-border" />

                  <div className="mb-[var(--space-lg)] flex flex-1 flex-col gap-[var(--space-sm)]">
                    {meta.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-[var(--space-sm)]">
                        <Check size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-success" />
                        <span className="text-body-sm text-text-primary">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {isCurrent ? (
                    <div className="w-full rounded-lg border border-border bg-background-soft py-[var(--space-sm)] text-center text-body-sm font-bold text-text-secondary">
                      Current Plan
                    </div>
                  ) : isPaid ? (
                    <button
                      type="button"
                      onClick={() => handleChoosePlan(plan.key as SubscriptionPlanKey, plan.name)}
                      disabled={isSwitching || subscriptionLoading}
                      className={`flex w-full items-center justify-center gap-[var(--space-xs)] rounded-lg py-[var(--space-sm)] text-body-sm font-bold disabled:opacity-60 ${
                        meta.highlight
                          ? "bg-primary text-white"
                          : "border border-primary text-primary"
                      }`}
                    >
                      {isSwitching ? (
                        "Switching…"
                      ) : (
                        <>
                          {plan.key === "enterprise" ? `Upgrade to ${plan.name}` : `Choose ${plan.name}`}
                          {meta.highlight && <ArrowRight size={16} strokeWidth={2.25} />}
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-[var(--space-xl)] flex flex-col items-center gap-[var(--space-sm)] border-t border-border pt-[var(--space-lg)] text-center">
            <p className="text-body-sm text-text-secondary">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
              Managing more than 10 entities or accounting clients?{" "}
              <button
                type="button"
                onClick={() => setEnquiryOpen(true)}
                className="font-bold text-primary underline underline-offset-2"
              >
                Contact for volume pricing
              </button>
            </p>
            <p className="flex items-center gap-[var(--space-sm)] text-caption text-text-secondary">
              <span className="flex items-center gap-1">
                <ShieldCheck size={14} strokeWidth={2.25} />
                256-bit Bank-grade Encryption
              </span>
              <span aria-hidden="true">•</span>
              <span>Cancel or switch anytime</span>
            </p>
          </div>

          <Link
            href="/paywall"
            className="mt-[var(--space-md)] flex items-center justify-center gap-[var(--space-xs)] py-[var(--space-sm)] text-caption font-semibold text-text-secondary"
          >
            <Eye size={14} strokeWidth={2} />
            Preview blocked screen (demo)
          </Link>
        </>
      )}

      {/*
        Mounted only while open, so each opening starts from a clean form —
        the modal holds no reset logic of its own. Same modal/props the
        original PlansContent uses; the Custom plan's feature list (see
        CUSTOM_PLAN above) is shown inside the modal via its own copy, not
        duplicated here.
      */}
      {enquiryOpen && (
        <CustomPlanEnquiryModal
          onClose={() => setEnquiryOpen(false)}
          surface="app"
          defaultName={enquiryName}
          defaultEmail={enquiryEmail}
          userId={typeof apiUser?._id === "string" ? apiUser._id : null}
        />
      )}
    </div>
  );
}
