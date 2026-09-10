import type { Metadata } from "next";

import { InvoiceReviewContent } from "@/components/invoices/InvoiceReviewContent";

export const metadata: Metadata = {
  title: "Invoice Review — Scantrix",
};

export default async function InvoiceReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceReviewContent invoiceId={id} />;
}
