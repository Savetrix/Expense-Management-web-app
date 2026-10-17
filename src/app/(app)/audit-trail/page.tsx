import type { Metadata } from "next";

import { AuditTrailContentV2 } from "@/components/v2/auditTrail/AuditTrailContentV2";

export const metadata: Metadata = {
  title: "Audit Trail — Scantrix",
};

export default function AuditTrailPage() {
  return <AuditTrailContentV2 />;
}
