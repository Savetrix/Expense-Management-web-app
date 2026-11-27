"use client";

import { BarChart3 } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";

// Invoices don't carry a company id, and per-user / per-range counts need a
// reporting endpoint, so there is nothing real to tabulate yet.
export function UsagePanel() {
  return (
    <EmptyState
      icon={<BarChart3 size={28} strokeWidth={1.75} />}
      title="No usage to show yet"
      description="Usage reports need the backend (BE). Processed, published and autopublished counts per company and user will appear here once it is connected."
    />
  );
}
