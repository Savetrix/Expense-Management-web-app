import { Suspense } from "react";
import type { Metadata } from "next";

import { GLTaxCodeContentV2 } from "@/components/v2/glTaxCode/GLTaxCodeContentV2";

export const metadata: Metadata = {
  title: "GL Account & TaxCode — Scantrix",
};

export default function GLTaxCodeV2Page() {
  return (
    <Suspense fallback={null}>
      <GLTaxCodeContentV2 />
    </Suspense>
  );
}
