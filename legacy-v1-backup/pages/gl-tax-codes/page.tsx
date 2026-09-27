import { Suspense } from "react";
import type { Metadata } from "next";

import { GLTaxCodeContent } from "@/components/glTaxCode/GLTaxCodeContent";

export const metadata: Metadata = {
  title: "GL Account & TaxCode — Scantrix",
};

export default function GLTaxCodePage() {
  return (
    <Suspense fallback={null}>
      <GLTaxCodeContent />
    </Suspense>
  );
}
