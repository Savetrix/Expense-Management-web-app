import { Suspense } from "react";
import type { Metadata } from "next";

import { InvoiceListContentV2 } from "@/components/v2/invoices/InvoiceListContentV2";

export const metadata: Metadata = {
  title: "Invoices — ScanTrix",
};

export default function InvoicesV2Page() {
  return (
    <Suspense fallback={null}>
      <InvoiceListContentV2 />
    </Suspense>
  );
}
