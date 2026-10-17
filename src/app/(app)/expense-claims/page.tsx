import type { Metadata } from "next";

import { ExpenseClaimsContentV2 } from "@/components/v2/expenseClaims/ExpenseClaimsContentV2";

export const metadata: Metadata = {
  title: "Expense Claims — Scantrix",
};

export default function ExpenseClaimsPage() {
  return <ExpenseClaimsContentV2 />;
}
