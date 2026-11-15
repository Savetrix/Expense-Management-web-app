import type { Metadata } from "next";

import { InvoiceReviewContentV2 } from "@/components/v2/invoices/InvoiceReviewContentV2";

export const metadata: Metadata = {
  title: "Invoice Review — ScanTrix",
};

export default async function InvoiceReviewV2Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  // Only back to the expense claims page (what links here) — a looser "starts
  // with /" check lets "/\evil.com" or a tab/newline trick send the user to
  // another site.
  const back = typeof returnTo === "string" && /^\/expense-claims(\?[A-Za-z0-9=,&_-]*)?$/.test(returnTo) ? returnTo : undefined;
  return <InvoiceReviewContentV2 invoiceId={id} returnTo={back} />;
}
