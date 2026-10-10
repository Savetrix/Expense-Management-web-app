import { Suspense } from "react";
import type { Metadata } from "next";

import { QuickBooksConnectContentV2 } from "@/components/v2/quickbooks/QuickBooksConnectContentV2";

export const metadata: Metadata = {
  title: "Accounting connections — Scantrix",
};

export default function QuickBooksV2Page() {
  return (
    <Suspense fallback={null}>
      <QuickBooksConnectContentV2 />
    </Suspense>
  );
}
