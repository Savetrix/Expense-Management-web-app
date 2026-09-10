import { Suspense } from "react";
import type { Metadata } from "next";

import { VerifyOtpContent } from "@/components/auth/VerifyOtpContent";

export const metadata: Metadata = {
  title: "Verify Email — Scantrix",
};

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={null}>
      <VerifyOtpContent />
    </Suspense>
  );
}
