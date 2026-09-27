import type { Metadata } from "next";

import { AccountingSoftwaresContentV2 } from "@/components/v2/accounting/AccountingSoftwaresContentV2";

export const metadata: Metadata = {
  title: "Integrations — Scantrix",
};

export default function AccountingSoftwareV2Page() {
  return <AccountingSoftwaresContentV2 />;
}
