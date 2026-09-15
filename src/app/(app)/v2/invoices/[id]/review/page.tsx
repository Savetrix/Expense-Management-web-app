import type { Metadata } from "next";

import { InvoiceReviewContentV2 } from "@/components/v2/invoices/InvoiceReviewContentV2";

export const metadata: Metadata = {
  title: "Invoice Review — Scantrix",
};

export default async function InvoiceReviewV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceReviewContentV2 invoiceId={id} />;
}
