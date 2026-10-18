"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BE_SUFFIX } from "@/lib/bePlaceholder";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { SectionKey } from "./types";

type WaitingKey = Exclude<SectionKey, "invoices">;

// Sections with no real data source yet. They never count as done, so the
// period can't look reconciled before the backend supplies the figures.
const COPY: Record<WaitingKey, { title: string; subject: string; link?: { href: string; label: string } }> = {
  bank: { title: "No bank lines to show", subject: "Bank lines still to sort" },
  adjustments: {
    title: "No pending adjustments to show",
    subject: "Pending adjustment journals",
    link: { href: "/month-end", label: "Open Month-End Adjustments" },
  },
  payablesReceivables: { title: "No aged balances to show", subject: "Aged payables and receivables" },
  fixedAssets: {
    title: "No fixed asset comparison to show",
    subject: "The fixed asset register and ledger totals",
    link: { href: "/month-end", label: "Open Month-End Adjustments" },
  },
  balanceSheet: { title: "No balance sheet balances to show", subject: "Balance sheet balances" },
};

export function waitingSummary(): string {
  return `Waiting for data ${BE_SUFFIX}`;
}

export function WaitingSection({ section }: { section: WaitingKey }) {
  const provider = useActiveProvider();
  const router = useRouter();
  const copy = COPY[section];
  return (
    <div className="flex flex-col items-center">
      <EmptyState
        icon={<Hourglass size={28} strokeWidth={1.75} />}
        title={copy.title}
        description={
          section === "bank"
            ? `${copy.subject} load from the backend once bank feeds are connected ${BE_SUFFIX}. This step stays open until then.`
            : `${copy.subject} load from ${provider.name} once the backend is connected ${BE_SUFFIX}. This step stays open until then.`
        }
      />
      {section === "bank" && (
        <Button size="sm" variant="outline" onClick={() => router.push("/bank-transactions")}>
          Open Bank Transactions
        </Button>
      )}
      {copy.link && (
        <Link href={copy.link.href} className="text-body-sm font-semibold text-accent hover:underline">
          {copy.link.label}
        </Link>
      )}
    </div>
  );
}
