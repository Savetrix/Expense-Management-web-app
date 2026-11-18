import { Suspense } from "react";
import type { Metadata } from "next";

import { BankTransactionsContentV2 } from "@/components/v2/bankTransactions/BankTransactionsContentV2";

export const metadata: Metadata = {
  title: "Bank Transactions — ScanTrix",
};

export default function BankTransactionsPage() {
  // Suspense: the page reads ?tab= (useSearchParams).
  return (
    <Suspense fallback={null}>
      <BankTransactionsContentV2 />
    </Suspense>
  );
}
