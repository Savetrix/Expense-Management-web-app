import { Suspense } from "react";
import type { Metadata } from "next";

import { ResetPasswordContent } from "@/components/auth/ResetPasswordContent";

export const metadata: Metadata = {
  title: "Reset Password — Scantrix",
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
