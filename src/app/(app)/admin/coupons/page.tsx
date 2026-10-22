import type { Metadata } from "next";

import { CouponsAdminContentV2 } from "@/components/v2/admin/CouponsAdminContentV2";

export const metadata: Metadata = {
  title: "Coupons — Scantrix",
};

export default function CouponsAdminPage() {
  return <CouponsAdminContentV2 />;
}
