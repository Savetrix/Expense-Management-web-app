import type { Metadata } from "next";

import { CloseContentV2 } from "@/components/v2/close/CloseContentV2";

export const metadata: Metadata = {
  title: "Working Papers — Scantrix",
};

export default function ClosePage() {
  return <CloseContentV2 />;
}
