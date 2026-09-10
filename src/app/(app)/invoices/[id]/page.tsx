import { Suspense } from "react";
import type { Metadata } from "next";

import { InvoiceDetailContent } from "@/components/invoices/InvoiceDetailContent";

export const metadata: Metadata = {
  title: "Invoice Details — Scantrix",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <InvoiceDetailContent invoiceId={id} />
    </Suspense>
  );
}
