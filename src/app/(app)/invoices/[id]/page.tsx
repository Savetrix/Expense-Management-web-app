import { Suspense } from "react";
import type { Metadata } from "next";

import { InvoiceDetailContentV2 } from "@/components/v2/invoices/InvoiceDetailContentV2";

export const metadata: Metadata = {
  title: "Invoice Details — Scantrix",
};

export default async function InvoiceDetailV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <InvoiceDetailContentV2 invoiceId={id} />
    </Suspense>
  );
}
