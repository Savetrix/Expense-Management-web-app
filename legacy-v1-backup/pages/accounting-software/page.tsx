import type { Metadata } from "next";

import { AccountingSoftwaresContent } from "@/components/accounting/AccountingSoftwaresContent";

export const metadata: Metadata = {
  title: "Integrations — Scantrix",
};

export default function AccountingSoftwarePage() {
  return <AccountingSoftwaresContent />;
}
