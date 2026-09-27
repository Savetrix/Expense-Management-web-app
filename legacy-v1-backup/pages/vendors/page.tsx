import { Suspense } from "react";
import type { Metadata } from "next";

import { VendorsContent } from "@/components/vendors/VendorsContent";

export const metadata: Metadata = {
  title: "Vendors — Scantrix",
};

export default function VendorsPage() {
  return (
    <Suspense fallback={null}>
      <VendorsContent />
    </Suspense>
  );
}
