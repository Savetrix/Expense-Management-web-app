// Shared invoice display helpers, consolidated from what Scantrix_v2 (mobile)
// reimplemented separately per screen (DashboardScreen's THEME_CONFIG/
// getInvoiceTitle/getInvoiceAmount, InvoiceListScreen + InvoiceDetailsScreen's
// own THEME_CONFIG copies, PendingInvoicesScreen's getPrimaryIssue). One
// source of truth here instead of repeating that per-screen drift.

export type InvoiceStatus = "auto" | "manual" | "pending" | "processing" | "failed";

export interface InvoiceStatusTheme {
  label: string;
  badgeClass: string;
  cardBgClass: string;
  /** Exact header/accent hex — kept alongside the Tailwind classes above
   * since headers use it as an inline background, not a text/bg utility. */
  accentHex: string;
  accentTextClass: string;
}

export const INVOICE_STATUS_THEME: Record<InvoiceStatus, InvoiceStatusTheme> = {
  auto: {
    label: "Auto-Posted",
    badgeClass: "bg-primary-100 text-primary-700",
    // Theme's success tokens — StatRow (Dashboard's Auto-posted/Manually
    // Posted/Failed pills) reads cardBgClass/accentTextClass, which now
    // stay correctly paired in dark mode instead of a fixed light tint.
    cardBgClass: "bg-status-success-bg",
    accentHex: "#06332f",
    accentTextClass: "text-status-success-text",
  },
  manual: {
    label: "Manually Posted",
    badgeClass: "bg-warning/10 text-warning",
    cardBgClass: "bg-status-warning-bg",
    accentHex: "#EDA320",
    accentTextClass: "text-status-warning-text",
  },
  pending: {
    label: "Pending",
    badgeClass: "bg-trust-navy/10 text-trust-navy",
    cardBgClass: "bg-[#E8F1FD]",
    accentHex: "#1F3A5F",
    accentTextClass: "text-trust-navy",
  },
  processing: {
    label: "Processing",
    badgeClass: "bg-warning/10 text-warning",
    cardBgClass: "bg-[#FFF7E6]",
    accentHex: "#EDA320",
    accentTextClass: "text-[#EDA320]",
  },
  failed: {
    label: "Failed",
    badgeClass: "bg-error/10 text-error",
    cardBgClass: "bg-status-danger-bg",
    accentHex: "#E74949",
    accentTextClass: "text-status-danger-text",
  },
};

// Backend now populates changedBy/uploadedBy/postedBy as User refs
// (firstName/lastName/email); older cached data or a raw ObjectId string
// can still show up, so callers must tolerate both shapes.
export interface PopulatedUserRef {
  _id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export function getUserDisplayName(user?: string | PopulatedUserRef | null): string {
  if (!user || typeof user === "string") return "";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || "";
}

export function getInvoiceStatus(status?: string): InvoiceStatus {
  if (status === "auto" || status === "manual" || status === "pending" || status === "processing" || status === "failed") {
    return status;
  }
  return "failed";
}

interface InvoiceLike {
  extractedData?: { vendorName?: string; invoiceNumber?: string; totalAmount?: number; currency?: string };
  file?: { originalName?: string };
  postedStatus?: string;
  statusHistory?: { reason?: string }[];
}

export function getInvoiceTitle(invoice: InvoiceLike): string {
  const vendor = invoice.extractedData?.vendorName;
  const invoiceNumber = invoice.extractedData?.invoiceNumber;
  if (vendor && invoiceNumber) return `${vendor} #${invoiceNumber}`;
  if (vendor) return vendor;
  const originalName = invoice.file?.originalName?.replace(/\.pdf$/i, "").replace(/%20/g, " ");
  return originalName || "Unknown Vendor";
}

export function getInvoiceAmount(invoice: InvoiceLike): string {
  const amount = invoice.extractedData?.totalAmount || 0;
  const currency = invoice.extractedData?.currency || "";
  return `${currency} ${amount}`.trim();
}

export function getInvoiceFailureReason(invoice: InvoiceLike): string {
  if (invoice.postedStatus !== "failed") return "";
  const latest = invoice.statusHistory?.[invoice.statusHistory.length - 1];
  return translateInvoiceReason(latest?.reason)?.message || "";
}

// Backend/QuickBooks failure reasons land in statusHistory[].reason verbatim
// (e.g. raw QBO fault text like "Business Validation Error: ... (code: 6000)").
// That's fine for support/debugging but reads as alarming, technical noise to
// a non-technical end user, so anything that *looks* raw gets swapped for a
// short plain-language explanation; the original is kept alongside for a
// "Show technical details" toggle rather than discarded.
export interface TranslatedInvoiceReason {
  /** Plain-language text safe to show by default. */
  message: string;
  /** The untouched backend/QuickBooks text, for a "technical details" toggle. */
  raw: string;
  /** False when `raw` already read as plain language and was passed through unchanged. */
  isTranslated: boolean;
}

const RAW_REASON_SIGNS: RegExp[] = [
  /\(code:\s*\d+\)/i,
  /business validation error/i,
  /\bfault\b/i,
  /\n\s*at\s+\S+/, // JS-style stack trace frame
  /^[a-z][\w.]*(?:error|exception):/i, // "TypeError: ...", "ValidationException: ..."
  /invalid_grant/i, // Intuit OAuth error code for a dead/revoked refresh token
  /invalid_token/i,
  /refresh token/i,
];

const KNOWN_REASON_TRANSLATIONS: { test: RegExp; message: string }[] = [
  {
    test: /\(code:\s*6000\)/i,
    message:
      "This invoice's currency doesn't match what QuickBooks expects for this vendor. Update the currency or contact support.",
  },
  {
    test: /invalid_grant|invalid_token|refresh token/i,
    message: "The QuickBooks connection needs to be reconnected.",
  },
];

const GENERIC_REASON_FALLBACK = "This invoice needs attention before it can be posted.";

export function translateInvoiceReason(reason?: string | null): TranslatedInvoiceReason | null {
  const raw = (reason || "").trim();
  if (!raw) return null;

  const looksRaw = RAW_REASON_SIGNS.some((pattern) => pattern.test(raw));
  if (!looksRaw) {
    return { message: raw, raw, isTranslated: false };
  }

  const known = KNOWN_REASON_TRANSLATIONS.find(({ test }) => test.test(raw));
  return { message: known?.message || GENERIC_REASON_FALLBACK, raw, isTranslated: true };
}

export function formatInvoiceDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface InvoiceWithDatesLike extends InvoiceLike {
  extractedData?: InvoiceLike["extractedData"] & { invoiceDate?: string | null };
  statusHistory?: { reason?: string; changedAt?: string }[];
}

export function getInvoicePostedDate(invoice: InvoiceWithDatesLike): string {
  const history = invoice.statusHistory;
  const latest = history && history.length > 0 ? history[history.length - 1] : undefined;
  return latest?.changedAt ? formatInvoiceDate(latest.changedAt) : formatInvoiceDate(invoice.extractedData?.invoiceDate);
}
