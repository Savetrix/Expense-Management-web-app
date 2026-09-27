import { Suspense } from "react";
import type { Metadata } from "next";

import { InvoiceListContent } from "@/components/invoices/InvoiceListContent";

export const metadata: Metadata = {
  title: "Invoices — Scantrix",
};

export default function InvoicesPage() {
  return (
    <Suspense fallback={null}>
      <InvoiceListContent />
    </Suspense>
  );
}
