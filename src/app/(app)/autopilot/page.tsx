import type { Metadata } from "next";

import { AutopilotContentV2 } from "@/components/v2/autopilot/AutopilotContentV2";

export const metadata: Metadata = {
  title: "Autopilot — Scantrix",
};

export default function AutopilotPage() {
  return <AutopilotContentV2 />;
}
