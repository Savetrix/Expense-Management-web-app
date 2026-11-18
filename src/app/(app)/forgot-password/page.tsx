import type { Metadata } from "next";

import { ForgotPasswordContent } from "@/components/auth/ForgotPasswordContent";

export const metadata: Metadata = {
  title: "Forgot Password — ScanTrix",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordContent />;
}
