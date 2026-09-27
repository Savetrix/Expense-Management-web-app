import type { Metadata } from "next";

import { VendorResolutionContent } from "@/components/invoices/VendorResolutionContent";

export const metadata: Metadata = {
  title: "Resolve Vendor — Scantrix",
};

export default async function VendorResolutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VendorResolutionContent invoiceId={id} />;
}
