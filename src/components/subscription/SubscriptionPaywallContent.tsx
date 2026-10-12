"use client";

import { useRouter } from "next/navigation";
import { Lock, X } from "lucide-react";

// Static block-screen copy — this page isn't wired to a real 402 trigger yet
// (no global interceptor redirects here); reachable today only via the
// "Preview blocked screen" link on /plans. "Upgrade Now" routes to the real,
// live /plans page.
const MOCK_BLOCK = {
  reasonCode: "SUBSCRIPTION_REQUIRED",
  title: "Subscription Required",
  message: "Your trial has ended. Upgrade to a paid plan to keep scanning invoices and syncing with your accounting software.",
};

export function SubscriptionPaywallContent() {
  const router = useRouter();

  const handleUpgrade = () => {
    router.push("/plans");
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="flex h-14 items-center px-[var(--space-md)]">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background-soft text-text-primary"
        >
          <X size={18} strokeWidth={2.25} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-[var(--space-xl)] text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <Lock size={34} strokeWidth={1.75} className="text-primary" />
        </span>

        <span className="mt-[var(--space-md)] rounded-pill bg-error/10 px-[var(--space-sm)] py-1 text-caption font-bold tracking-wide text-error">
          {MOCK_BLOCK.reasonCode}
        </span>

        <h1 className="mt-[var(--space-md)] text-h2 font-bold text-trust-navy">{MOCK_BLOCK.title}</h1>
        <p className="mt-[var(--space-sm)] max-w-sm text-body-sm text-text-secondary">{MOCK_BLOCK.message}</p>

        <button
          type="button"
          onClick={handleUpgrade}
          className="mt-[var(--space-xl)] w-full max-w-sm rounded-lg bg-primary py-[var(--space-sm)] font-bold text-white"
        >
          Upgrade Now
        </button>
        <button type="button" onClick={() => router.back()} className="mt-[var(--space-sm)] font-semibold text-text-secondary">
          Maybe Later
        </button>
      </div>
    </div>
  );
}
