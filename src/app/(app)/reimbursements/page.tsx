import type { Metadata } from "next";

import { ExpenseClaimsContentV2 } from "@/components/v2/expenseClaims/ExpenseClaimsContentV2";

export const metadata: Metadata = {
  title: "Reimbursements — ScanTrix",
};

// Coming back from editing a receipt on the review screen: `newClaim` reopens
// the new-claim wizard with those receipts ticked, `claim` reopens that claim.
export default async function ExpenseClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ newClaim?: string | string[]; claim?: string | string[] }>;
}) {
  const { newClaim, claim } = await searchParams;
  const ids = typeof newClaim === "string" ? newClaim.split(",").filter((id) => /^[a-f\d]{24}$/i.test(id)) : null;
  const claimId = typeof claim === "string" && /^[a-f\d]{24}$/i.test(claim) ? claim : null;
  return <ExpenseClaimsContentV2 reopenWizardWith={ids} reopenClaimId={claimId} />;
}
