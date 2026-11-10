import type { Metadata } from "next";

import { BankTransactionsContentV2 } from "@/components/v2/bankTransactions/BankTransactionsContentV2";

export const metadata: Metadata = {
  title: "Bank Transactions — ScanTrix",
};

export default function BankTransactionsPage() {
  return <BankTransactionsContentV2 />;
}
