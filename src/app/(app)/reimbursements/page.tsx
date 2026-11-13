import type { Metadata } from "next";

import { ExpenseClaimsContentV2 } from "@/components/v2/expenseClaims/ExpenseClaimsContentV2";

export const metadata: Metadata = {
  title: "Reimbursements — ScanTrix",
};

export default function ExpenseClaimsPage() {
  return <ExpenseClaimsContentV2 />;
}
