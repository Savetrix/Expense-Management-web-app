import type { Metadata } from "next";

import { TeamMembersContentV2 } from "@/components/v2/team/TeamMembersContentV2";

export const metadata: Metadata = {
  title: "Team Members — Scantrix",
};

export default function TeamV2Page() {
  return <TeamMembersContentV2 />;
}
