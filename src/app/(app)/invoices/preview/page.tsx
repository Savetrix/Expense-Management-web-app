import { Suspense } from "react";
import type { Metadata } from "next";

import { InvoicePreviewContent } from "@/components/invoices/InvoicePreviewContent";

export const metadata: Metadata = {
  title: "Invoice Preview — Scantrix",
};

export default function InvoicePreviewPage() {
  return (
    <Suspense fallback={null}>
      <InvoicePreviewContent />
    </Suspense>
  );
}
