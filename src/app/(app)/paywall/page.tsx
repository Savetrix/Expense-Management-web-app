import type { Metadata } from "next";

import { SubscriptionPaywallContent } from "@/components/subscription/SubscriptionPaywallContent";

export const metadata: Metadata = {
  title: "Subscription Required — Scantrix",
};

export default function SubscriptionPaywallPage() {
  return <SubscriptionPaywallContent />;
}
