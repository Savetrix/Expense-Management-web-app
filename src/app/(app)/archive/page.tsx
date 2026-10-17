import type { Metadata } from "next";

import { ArchiveContentV2 } from "@/components/v2/archive/ArchiveContentV2";

export const metadata: Metadata = {
  title: "Archive & Duplicates — Scantrix",
};

export default function ArchivePage() {
  return <ArchiveContentV2 />;
}
