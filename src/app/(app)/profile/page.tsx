import type { Metadata } from "next";

import { ProfileContent } from "@/components/profile/ProfileContent";

export const metadata: Metadata = {
  title: "Account — Scantrix",
};

export default function ProfilePage() {
  return <ProfileContent />;
}
