import { Suspense } from "react";
import type { Metadata } from "next";

import { RegisterFormV2 } from "@/components/v2/auth/RegisterFormV2";

export const metadata: Metadata = {
  title: "Create Account — Scantrix",
};

export default function RegisterV2Page() {
  return (
    <Suspense fallback={null}>
      <RegisterFormV2 />
    </Suspense>
  );
}
