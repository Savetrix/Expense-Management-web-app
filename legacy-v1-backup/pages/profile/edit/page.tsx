import type { Metadata } from "next";

import { EditProfileContent } from "@/components/profile/EditProfileContent";

export const metadata: Metadata = {
  title: "Edit Profile — Scantrix",
};

export default function EditProfilePage() {
  return <EditProfileContent />;
}
