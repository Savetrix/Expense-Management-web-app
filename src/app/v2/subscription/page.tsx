import type { Metadata } from "next";

import { SubscriptionStatusContentV2 } from "@/components/v2/subscription/SubscriptionStatusContentV2";

export const metadata: Metadata = {
  title: "Subscription — Scantrix",
};

export default function SubscriptionV2Page() {
  return <SubscriptionStatusContentV2 />;
}
