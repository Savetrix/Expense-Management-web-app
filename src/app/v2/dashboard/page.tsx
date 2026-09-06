import type { Metadata } from "next";

import { DashboardContentV2 } from "@/components/v2/dashboard/DashboardContentV2";

export const metadata: Metadata = {
  title: "Dashboard — Scantrix",
};

export default function DashboardV2Page() {
  return (
      <DashboardContentV2 />
  );
}
