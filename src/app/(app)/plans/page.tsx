import type { Metadata } from "next";

import { PlansContentV2 } from "@/components/v2/subscription/PlansContentV2";

export const metadata: Metadata = {
  title: "Plans — Scantrix",
};

export default function PlansV2Page() {
  return <PlansContentV2 />;
}
