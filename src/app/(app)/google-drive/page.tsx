import { Suspense } from "react";
import type { Metadata } from "next";

import { StorageCallbackContentV2 } from "@/components/v2/accounting/StorageCallbackContentV2";

export const metadata: Metadata = {
  title: "Connecting Google Drive — Scantrix",
};

export default function GoogleDriveCallbackV2Page() {
  return (
    <Suspense fallback={null}>
      <StorageCallbackContentV2 providerName="Google Drive" />
    </Suspense>
  );
}
