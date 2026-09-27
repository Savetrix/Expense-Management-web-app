import type { Metadata } from "next";

import { SubscriptionStatusContent } from "@/components/subscription/SubscriptionStatusContent";

export const metadata: Metadata = {
  title: "Subscription — Scantrix",
};

export default function SubscriptionPage() {
  return <SubscriptionStatusContent />;
}
