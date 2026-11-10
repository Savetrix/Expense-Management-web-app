import type { Metadata } from "next";

import { EditProfileContentV2 } from "@/components/v2/profile/EditProfileContentV2";

export const metadata: Metadata = {
  title: "Edit Profile — ScanTrix",
};

export default function EditProfileV2Page() {
  return <EditProfileContentV2 />;
}
