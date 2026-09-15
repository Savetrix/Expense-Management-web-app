import type { Metadata } from "next";

import { PreferencesContentV2 } from "@/components/v2/preferences/PreferencesContentV2";

export const metadata: Metadata = {
  title: "Preferences — Scantrix",
};

export default function PreferencesV2Page() {
  return <PreferencesContentV2 />;
}
