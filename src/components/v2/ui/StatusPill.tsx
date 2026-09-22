import { INVOICE_STATUS_PILL_STYLE, type InvoiceStatus } from "@/lib/invoiceDisplay";

// Renders an invoice's postedStatus as the colored-dot pill design (dot +
// colored text on a tinted bg) — shared by the dashboard's Recent list and
// the invoices list page so they can never drift into different colors for
// the same status again. See INVOICE_STATUS_PILL_STYLE for the per-status
// classes.
export function StatusPill({ status }: { status: InvoiceStatus }) {
  const style = INVOICE_STATUS_PILL_STYLE[status];
  return (
    <span
      className={`inline-flex w-fit items-center gap-[6px] rounded-pill px-[var(--space-sm)] py-[2px] text-caption font-bold ${style.bg} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
