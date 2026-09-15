import { Suspense } from "react";
import type { Metadata } from "next";

import { LoginFormV2 } from "@/components/v2/auth/LoginFormV2";

export const metadata: Metadata = {
  title: "Log in — Scantrix",
};

export default function LoginV2Page() {
  return (
    <Suspense fallback={null}>
      <LoginFormV2 />
    </Suspense>
  );
}
