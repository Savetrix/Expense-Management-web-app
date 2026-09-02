"use client";

import Link from "next/link";
import { Check, ChevronRight, Eye, Sparkles } from "lucide-react";
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

// Presentation-only metadata the backend catalog doesn't carry (tagline,
// feature bullets, which card to highlight) — pricing/maxSlots always come
// from the live GET /subscription/plans response, keyed here by plan id.
const PLAN_META: Record<string, { tagline: string; features: string[]; highlight?: boolean }> = {
  trial: {
    tagline: "Try Scantrix free for 14 days",
    features: ["Unlimited scans", "Unlimited team members", "1 QuickBooks slot"],
  },
  standard: {
    tagline: "For growing teams",
    features: ["Unlimited scans", "Unlimited team members", "1 QuickBooks slot"],
  },
  enterprise: {
    tagline: "For multi-entity businesses",
    features: ["Unlimited scans", "Unlimited team members", "3 QuickBooks slots"],
    highlight: true,
  },
};

// The Custom plan is NOT in PLAN_META and is NOT rendered from `plans`.
//
// That separation is deliberate. `plans` comes from GET /subscription/plans, the
// backend's billing catalog — every entry there is something Stripe can charge
// for. Custom has no price, no billing interval and no checkout; it is a
// conversation. Adding a synthetic entry to the catalog array would put a
// non-purchasable key in front of handleChoosePlan and the isCurrent/isPaid
// logic, which is exactly the kind of quiet coupling that breaks the three
// working plans later. It renders as its own card, after the map, sharing only
// the visual language.
const CUSTOM_PLAN = {
  name: "Custom",
  tagline: "For businesses that need more than the plans above",
  price: "Let's talk",
  suffix: "priced on your requirements",
  features: [
    "Invoice volumes sized to your throughput",
    "Multiple companies and entities under one account",
    "Large teams, with roles that match how you work",
    "Custom integrations and approval workflows",
    "Guided onboarding and priority support",
  ],
} as const;

function priceLabel(planKey: string, prices: { monthly: number; yearly: number } | null, cycle: BillingCycle) {
  if (planKey === "trial" || !prices) return "Free";
  return `$${cycle === "monthly" ? prices.monthly : prices.yearly}`;
}

function priceSuffix(planKey: string, cycle: BillingCycle) {
  if (planKey === "trial") return "for 14 days";
  return cycle === "monthly" ? "/mo" : "/yr";
}

export function PlansContent() {
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
    // Guard against clicking before fetchMySubscription resolves — subscription
    // is still null right after mount, so subscription?.provider === "stripe"
    // would read false even for an existing Stripe/mobile subscriber, sending
    // them into a fresh Checkout Session instead of the Billing Portal. The
    // backend also blocks this server-side (see stripe.service.js
    // createCheckoutSession), but that just surfaces as a confusing error
    // toast instead of routing correctly, so guard it here too.
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

  // Prefill from the signed-in account. Same `user?.data?.user` shape the
  // profile screens read (src/components/profile/ProfileContent.tsx) — this
  // page is behind AuthGate, so somebody is always signed in here. Purely a
  // convenience: the server never trusts any of it.
  const apiUser = user?.data?.user;
  const enquiryName = [apiUser?.firstName, apiUser?.lastName].filter(Boolean).join(" ");
  const enquiryEmail = typeof apiUser?.email === "string" ? apiUser.email : "";

  return (
    <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
      <h1 className="text-h2 font-bold text-trust-navy">Choose your plan</h1>
      <p className="mb-[var(--space-md)] mt-[var(--space-xs)] text-body-sm text-text-secondary">
        Pick the plan that fits your team.
      </p>

      <Link
        href="/subscription"
        className="mb-[var(--space-lg)] flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-lg border border-border bg-background-soft px-[var(--space-md)] py-[var(--space-sm)]"
      >
        <span className="min-w-0 truncate text-body-sm text-text-secondary">
          Current plan: <strong className="font-bold text-trust-navy">{currentPlanName}</strong>
        </span>
        <span className="flex shrink-0 items-center gap-[var(--space-xs)] text-caption font-bold text-primary">
          View status <ChevronRight size={14} strokeWidth={2.25} />
        </span>
      </Link>

      <div className="mb-[var(--space-lg)] flex rounded-pill bg-background-soft p-1">
        {(["monthly", "yearly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCycle(option)}
            className={`flex-1 rounded-pill py-[var(--space-sm)] text-body-sm font-bold capitalize ${
              cycle === option ? "bg-primary text-white" : "text-text-secondary"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {plansLoading ? (
        <div className="flex justify-center py-[var(--space-xl)]">
          <Spinner size="md" />
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--space-md)]">
          {plans.map((plan) => {
            const meta = PLAN_META[plan.key] ?? { tagline: "", features: [] };
            const isPaid = plan.key !== "trial";
            const isCurrent =
              subscription?.status !== "expired" &&
              subscription?.plan === plan.key &&
              (!isPaid || subscription?.billingInterval === cycle);
            const isSwitching = switchingKey === `${plan.key}-${cycle}`;

            return (
              <div
                key={plan.key}
                className={`relative rounded-xl border bg-white p-[var(--space-md)] ${
                  meta.highlight ? "border-2 border-primary" : "border-border"
                }`}
              >
                {meta.highlight && (
                  <span className="absolute -top-3 right-[var(--space-md)] rounded-pill bg-primary px-[var(--space-sm)] py-1 text-caption font-bold tracking-wide text-white">
                    MOST POPULAR
                  </span>
                )}

                <p className="text-h3 font-bold text-text-primary">{plan.name}</p>
                <p className="text-caption text-text-secondary">{meta.tagline}</p>

                <div className="mt-[var(--space-sm)] flex items-end gap-1">
                  <span className="text-h1 font-bold text-text-primary">{priceLabel(plan.key, plan.prices, cycle)}</span>
                  <span className="mb-1 text-body-sm text-text-secondary">{priceSuffix(plan.key, cycle)}</span>
                </div>
                {isPaid && cycle === "yearly" && plan.prices && (
                  <p className="mt-[var(--space-xs)] text-caption font-semibold text-success">~17% off billed yearly</p>
                )}

                <div className="my-[var(--space-sm)] h-px bg-border" />

                <div className="mb-[var(--space-md)] flex flex-col gap-[var(--space-xs)]">
                  {meta.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-[var(--space-sm)]">
                      <Check size={16} strokeWidth={2.5} className="shrink-0 text-success" />
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
                    className={`w-full rounded-lg py-[var(--space-sm)] text-body-sm font-bold disabled:opacity-60 ${
                      meta.highlight ? "bg-primary text-white" : "border border-border bg-background-soft text-text-primary"
                    }`}
                  >
                    {isSwitching ? "Switching…" : "Choose Plan"}
                  </button>
                ) : null}
              </div>
            );
          })}

          {/*
            Rendered outside the catalog map on purpose — see CUSTOM_PLAN above.
            It also survives a failed fetchPlans: if the catalog never arrives,
            `plans` is empty and this card is still here, so the route to a
            human is never taken away by a backend outage.
          */}
          <div className="relative rounded-xl border border-dashed border-primary/60 bg-primary-50/40 p-[var(--space-md)]">
            <div className="flex items-center gap-[var(--space-sm)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15">
                <Sparkles size={16} strokeWidth={2.25} className="text-primary-700" />
              </span>
              <div className="min-w-0">
                <p className="text-h3 font-bold text-text-primary">{CUSTOM_PLAN.name}</p>
                <p className="text-caption text-text-secondary">{CUSTOM_PLAN.tagline}</p>
              </div>
            </div>

            <div className="mt-[var(--space-sm)] flex flex-wrap items-end gap-1">
              <span className="text-h1 font-bold text-text-primary">{CUSTOM_PLAN.price}</span>
              <span className="mb-1 text-body-sm text-text-secondary">{CUSTOM_PLAN.suffix}</span>
            </div>

            <div className="my-[var(--space-sm)] h-px bg-border" />

            <div className="mb-[var(--space-md)] flex flex-col gap-[var(--space-xs)]">
              {CUSTOM_PLAN.features.map((feature) => (
                <div key={feature} className="flex items-start gap-[var(--space-sm)]">
                  <Check size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-success" />
                  <span className="text-body-sm text-text-primary">{feature}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setEnquiryOpen(true)}
              className="w-full rounded-lg bg-trust-navy py-[var(--space-sm)] text-body-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
            >
              Talk to Sales
            </button>
          </div>

          <Link
            href="/paywall"
            className="mt-[var(--space-xs)] flex items-center justify-center gap-[var(--space-xs)] py-[var(--space-sm)] text-caption font-semibold text-text-secondary"
          >
            <Eye size={14} strokeWidth={2} />
            Preview blocked screen (demo)
          </Link>
        </div>
      )}

      {/*
        Mounted only while open, so each opening starts from a clean form —
        the modal holds no reset logic of its own. See CustomPlanEnquiryModal.
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
