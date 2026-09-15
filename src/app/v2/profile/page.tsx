import type { Metadata } from "next";

import { ProfileContentV2 } from "@/components/v2/profile/ProfileContentV2";

export const metadata: Metadata = {
  title: "Account — Scantrix",
};

export default function ProfileV2Page() {
  return <ProfileContentV2 />;
}
