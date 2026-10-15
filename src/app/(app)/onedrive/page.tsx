import { Suspense } from "react";
import type { Metadata } from "next";

import { StorageCallbackContentV2 } from "@/components/v2/accounting/StorageCallbackContentV2";

export const metadata: Metadata = {
  title: "Connecting OneDrive — Scantrix",
};

export default function OneDriveCallbackV2Page() {
  return (
    <Suspense fallback={null}>
      <StorageCallbackContentV2 providerName="OneDrive" />
    </Suspense>
  );
}
