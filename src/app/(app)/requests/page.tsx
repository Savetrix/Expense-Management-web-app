import { Suspense } from "react";
import type { Metadata } from "next";

import { RequestsContentV2 } from "@/components/v2/requests/RequestsContentV2";

export const metadata: Metadata = {
  title: "Paperwork Requests — Scantrix",
};

export default function RequestsPage() {
  return (
    <Suspense fallback={null}>
      <RequestsContentV2 />
    </Suspense>
  );
}
