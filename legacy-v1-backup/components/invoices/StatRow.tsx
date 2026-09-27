import Link from "next/link";

import { INVOICE_STATUS_THEME } from "@/lib/invoiceDisplay";

// Shared between DashboardContent and InvoiceListContent so both surfaces
// derive their color from INVOICE_STATUS_THEME instead of each keeping its
// own copy — a duplicated mapping is exactly how the dashboard's version of
// this once drifted onto --color-success instead of the theme's own color.
export function StatRow({
  count,
  label,
  href,
  theme,
}: {
  count: number;
  label: string;
  href: string;
  theme: "auto" | "manual" | "failed";
}) {
  const { cardBgClass, accentTextClass } = INVOICE_STATUS_THEME[theme];
  return (
    <Link
      href={href}
      className={`flex flex-1 items-center justify-between gap-[var(--space-sm)] rounded-lg p-[var(--space-md)] ${cardBgClass}`}
    >
      <span className={`text-body-sm font-semibold ${accentTextClass}`}>{label}</span>
      <span className={`text-h1 font-bold ${accentTextClass}`}>{count}</span>
    </Link>
  );
}
