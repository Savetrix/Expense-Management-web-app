import type { Metadata } from "next";

import { TeamMembersContent } from "@/components/team/TeamMembersContent";

export const metadata: Metadata = {
  title: "Team Members — Scantrix",
};

export default function TeamPage() {
  return <TeamMembersContent />;
}
