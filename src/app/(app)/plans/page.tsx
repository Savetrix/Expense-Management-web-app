import type { Metadata } from "next";

import { PlansContent } from "@/components/subscription/PlansContent";

export const metadata: Metadata = {
  title: "Plans — Scantrix",
};

export default function PlansPage() {
  return <PlansContent />;
}
