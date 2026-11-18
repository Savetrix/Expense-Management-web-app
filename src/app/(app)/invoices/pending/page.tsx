import type { Metadata } from "next";

import { PendingInvoicesContent } from "@/components/invoices/PendingInvoicesContent";

export const metadata: Metadata = {
  title: "Pending Reviews — ScanTrix",
};

export default function PendingInvoicesPage() {
  return <PendingInvoicesContent />;
}
