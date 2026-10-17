import type { Metadata } from "next";

import { MonthEndContentV2 } from "@/components/v2/monthEnd/MonthEndContentV2";

export const metadata: Metadata = {
  title: "Month-End Adjustments — Scantrix",
};

export default function MonthEndPage() {
  return <MonthEndContentV2 />;
}
