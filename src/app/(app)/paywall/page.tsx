import type { Metadata } from "next";

import { SubscriptionPaywallContent } from "@/components/subscription/SubscriptionPaywallContent";

export const metadata: Metadata = {
  title: "Subscription Required — ScanTrix",
};

export default function SubscriptionPaywallPage() {
  return <SubscriptionPaywallContent />;
}
