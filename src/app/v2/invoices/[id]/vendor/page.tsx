import type { Metadata } from "next";

import { VendorResolutionContentV2 } from "@/components/v2/invoices/VendorResolutionContentV2";

export const metadata: Metadata = {
  title: "Resolve Vendor — Scantrix",
};

export default async function VendorResolutionV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VendorResolutionContentV2 invoiceId={id} />;
}
