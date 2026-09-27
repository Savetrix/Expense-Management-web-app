import type { Metadata } from "next";

import { PreferencesContent } from "@/components/preferences/PreferencesContent";

export const metadata: Metadata = {
  title: "Preferences — Scantrix",
};

export default function PreferencesPage() {
  return <PreferencesContent />;
}
