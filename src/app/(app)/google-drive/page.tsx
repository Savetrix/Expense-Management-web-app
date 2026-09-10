import { Suspense } from "react";
import type { Metadata } from "next";

import { GoogleDriveCallbackContent } from "@/components/accounting/GoogleDriveCallbackContent";

export const metadata: Metadata = {
  title: "Connecting Google Drive — Scantrix",
};

export default function GoogleDriveCallbackPage() {
  return (
    <Suspense fallback={null}>
      <GoogleDriveCallbackContent />
    </Suspense>
  );
}
