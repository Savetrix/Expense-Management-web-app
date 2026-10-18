import type { Metadata } from "next";

import { ReportsContent } from "@/components/v2/reports/ReportsContent";

export const metadata: Metadata = {
  title: "Reports — Scantrix",
};

export default function ReportsPage() {
  return <ReportsContent />;
}
