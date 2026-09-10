import { Suspense } from "react";
import type { Metadata } from "next";

import { InviteAcceptContent } from "@/components/auth/InviteAcceptContent";

export const metadata: Metadata = {
  title: "Accept Invite — Scantrix",
};

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={null}>
      <InviteAcceptContent />
    </Suspense>
  );
}
