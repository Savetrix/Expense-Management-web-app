import type { Metadata } from "next";

import { ForgotPasswordContent } from "@/components/auth/ForgotPasswordContent";

export const metadata: Metadata = {
  title: "Forgot Password — Scantrix",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordContent />;
}
