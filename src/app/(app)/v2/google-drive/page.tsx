import { Suspense } from "react";
import type { Metadata } from "next";

import { GoogleDriveCallbackContentV2 } from "@/components/v2/accounting/GoogleDriveCallbackContentV2";

export const metadata: Metadata = {
  title: "Connecting Google Drive — Scantrix",
};

export default function GoogleDriveCallbackV2Page() {
  return (
    <Suspense fallback={null}>
      <GoogleDriveCallbackContentV2 />
    </Suspense>
  );
}
