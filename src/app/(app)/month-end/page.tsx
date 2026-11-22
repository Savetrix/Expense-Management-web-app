import type { Metadata } from "next";

import { MonthEndContentV2 } from "@/components/v2/monthEnd/MonthEndContentV2";

export const metadata: Metadata = {
  title: "Month-End Adjustments — ScanTrix",
};

// `prepayment` (from an invoice's "View schedule" link) opens that schedule.
export default async function MonthEndPage({ searchParams }: { searchParams: Promise<{ prepayment?: string | string[] }> }) {
  const { prepayment } = await searchParams;
  const id = typeof prepayment === "string" && /^[a-f\d]{24}$/i.test(prepayment) ? prepayment : null;
  return <MonthEndContentV2 openPrepaymentId={id} />;
}
