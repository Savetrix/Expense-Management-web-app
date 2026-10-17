import type { Metadata } from "next";

import { SupplierStatementsContentV2 } from "@/components/v2/supplierStatements/SupplierStatementsContentV2";

export const metadata: Metadata = {
  title: "Supplier Statements — Scantrix",
};

export default function SupplierStatementsPage() {
  return <SupplierStatementsContentV2 />;
}
