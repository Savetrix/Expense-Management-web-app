import type { Metadata } from "next";

import { PaymentsContentV2 } from "@/components/v2/payments/PaymentsContentV2";

export const metadata: Metadata = {
  title: "Payments — Scantrix",
};

export default function PaymentsPage() {
  return <PaymentsContentV2 />;
}
