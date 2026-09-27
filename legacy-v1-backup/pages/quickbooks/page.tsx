import { Suspense } from "react";
import type { Metadata } from "next";

import { QuickBooksConnectContent } from "@/components/quickbooks/QuickBooksConnectContent";

export const metadata: Metadata = {
  title: "QuickBooks — Scantrix",
};

export default function QuickBooksPage() {
  return (
    <Suspense fallback={null}>
      <QuickBooksConnectContent />
    </Suspense>
  );
}
