import { Suspense } from "react";
import type { Metadata } from "next";

import { VendorsContentV2 } from "@/components/v2/vendors/VendorsContentV2";

export const metadata: Metadata = {
  title: "Vendors — Scantrix",
};

export default function VendorsV2Page() {
  return (
    <Suspense fallback={null}>
      <VendorsContentV2 />
    </Suspense>
  );
}
