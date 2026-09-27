"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  StickyNote,
  Trash2,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { CSSProperties } from "react";
import { ChangeEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { InlineEditField, SelectDropdown } from "@/components/v2/ui";
import type { InlineEditFieldHandle } from "@/components/v2/ui";
import { VendorResolutionDialogV2 } from "@/components/v2/invoices/VendorResolutionDialogV2";
import { InvoiceHeroCard } from "@/components/v2/invoices/InvoiceHeroCard";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getInvoiceDetails,
  getInvoices,
  postInvoiceToQuickBooks,
  rejectInvoice,
  updateInvoiceExtractedData,
} from "@/store/invoice/invoiceApi";
import type { Discount, ExtraCharge, LineItem } from "@/store/invoice/invoiceSlice";
import {
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
} from "@/store/quickBooks/quickBooksApi";
import { clearVendorResolutionForOtherInvoice, setSelectedVendor } from "@/store/vendor/vendorSlice";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { formatDetailAmount, formatDetailDateTime, resolveInvoiceDetailType } from "@/lib/invoiceDetailTheme";
import { getUserDisplayName, translateInvoiceReason } from "@/lib/invoiceDisplay";
import { formatTaxRate, taxCodeId as getTaxCodeId, taxCodeLabel as getTaxCodeLabel } from "@/lib/quickbooks/taxCode";
import type { TaxCode } from "@/store/quickBooks/quickBooksSlice";

// Zoom only applies to the <img> case — a PDF's own embedded viewer already
// has native zoom/scroll. Ported from InvoiceReviewContent (v1) so the two
// screens' scanned-copy viewers behave identically.
const SCAN_MIN_ZOOM = 1;
const SCAN_MAX_ZOOM = 3;
const SCAN_ZOOM_STEP = 0.5;

// Drag-to-resize range for the Scanned Copy panel — "minimize" down to a
// compact strip, "maximize" up to a near-full-height reading view.
const SCAN_PANEL_DEFAULT_HEIGHT = 600;
const SCAN_PANEL_MIN_HEIGHT = 280;
const SCAN_PANEL_MAX_HEIGHT = 1000;

// Drag-to-resize range for the right-hand panel's width (Scanned Copy,
// Vendor Details, Item Description Notes, Status History).
const ASIDE_DEFAULT_WIDTH = 400;
const ASIDE_MIN_WIDTH = 300;
const ASIDE_MAX_WIDTH = 680;

interface NormalizedInvoiceData {
  vendor: string;
  vendorAddress: string;
  vendorBankDetails: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amountBeforeTax: string;
  taxAmount: string;
  totalAfterTax: string;
  currency: string;
  glAccountId: string;
  taxCodeId: string;
  itemDescriptionsText: string;
}

function safeValue(value?: string | number | null): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function cleanValue(value?: string | null): string {
  if (!value || !String(value).trim()) return "";
  return String(value).trim();
}

// A line item's amount is always quantity × unit price — never the raw
// extracted "amount" field, which is a separate LLM guess that can disagree
// with qty×unitPrice (the two are independently extracted, so nothing
// guarantees they agree). Applied both on load (so a stale/wrong extracted
// amount never even shows up) and on every quantity/unitPrice edit.
function computeLineItemAmount(quantity: number, unitPrice: number): number {
  return parseFloat(((Number(quantity) || 0) * (Number(unitPrice) || 0)).toFixed(2));
}

function withComputedLineItemAmounts(items: LineItem[]): LineItem[] {
  return items.map((item) => ({ ...item, amount: computeLineItemAmount(item.quantity, item.unitPrice) }));
}

// Fills each line's GL/tax code from the invoice-level (vendor) ones where
// the line has none yet, so every line shows — and saves — an explicit value.
// Lines that already carry their own value are left alone.
function withLineDefaults(items: LineItem[], glAccountId: string, taxCodeId: string): LineItem[] {
  return items.map((item) => ({
    ...item,
    glAccountId: item.glAccountId || glAccountId || undefined,
    taxCodeId: item.taxCodeId || taxCodeId || null,
  }));
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Tax is computed from line items only — never extra charges or discounts
// (both post to QuickBooks as non-taxable). Each line uses its own taxCodeId,
// else the invoice-level (vendor) one, else 0%. Mirrors how QuickBooks itself
// computes a Bill's tax: taxable amounts are pooled per tax RATE (so GST on
// a "GST" line and a "GST/PST BC" line is one pool) and each pool is rounded
// once — rounding per line instead would drift from QB by a cent here and
// there. hasUnknownRate = some line's code has no synced rate (or isn't in
// the list at all); that line contributes 0 and the UI flags it.
function computeLineItemsTax(
  items: LineItem[],
  fallbackTaxCodeId: string,
  taxCodeById: Map<string, TaxCode>,
): {
  tax: number;
  hasUnknownRate: boolean;
  usedCodeIds: string[];
  /** One entry per QuickBooks tax rate actually charged (0% rates omitted). */
  breakdown: { rateId: string; name: string; rate: number; amount: number }[];
} {
  const pools = new Map<string, { name: string; rate: number; base: number }>();
  const usedCodeIds = new Set<string>();
  let hasUnknownRate = false;

  for (const item of items) {
    const codeId = item.taxCodeId || fallbackTaxCodeId;
    if (!codeId) continue;
    usedCodeIds.add(codeId);
    const code = taxCodeById.get(codeId);
    if (!code || code.totalRate == null) {
      hasUnknownRate = true;
      continue;
    }
    for (const component of code.taxRateIds ?? []) {
      if (component.rate == null) continue;
      const pool = pools.get(component.value) ?? { name: component.name, rate: component.rate, base: 0 };
      pool.base += Number(item.amount) || 0;
      pools.set(component.value, pool);
    }
  }

  const breakdown = [...pools.entries()]
    .map(([rateId, { name, rate, base }]) => ({ rateId, name, rate, amount: roundMoney((base * rate) / 100) }))
    .filter((entry) => entry.rate > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const tax = breakdown.reduce((sum, entry) => sum + entry.amount, 0);
  return { tax: roundMoney(tax), hasUnknownRate, usedCodeIds: [...usedCodeIds], breakdown };
}

// Extracted dates can arrive in whatever format the scan produced. Normalizes
// what it can into YYYY-MM-DD (what <input type="date"> requires) and
// returns "" for anything it can't confidently parse.
function toDateInputValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Field names match the authoritative ported contract (invoiceSlice.ts's
// ExtractedData / invoiceApi.ts's PostInvoiceExtractedData) — see the
// identical helper in InvoiceReviewContent.tsx (v1) for the full rationale.
function normalizeInvoiceData(data: {
  vendorName?: string;
  vendorAddress?: string | null;
  bankingDetails?: string | null;
  invoiceNumber?: string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  amountBeforeTax?: number;
  taxAmount?: number;
  totalAmount?: number;
  currency?: string;
  glAccountId?: string | null;
  taxCodeId?: string | null;
  description?: string | null;
  lineItems?: LineItem[];
  extraCharges?: ExtraCharge[];
  discounts?: Discount[];
}): NormalizedInvoiceData {
  // When the subtotal wasn't extracted but line items were, derive it from
  // the line items' own sum — NOT netting extraCharges/discounts in here,
  // since those are separate, total-level adjustments (see computedTotal
  // below); folding them into amountBeforeTax too would make it disagree
  // with the line items sum it was just derived from.
  let amountBeforeTax = data.amountBeforeTax;
  if (amountBeforeTax == null && Array.isArray(data.lineItems) && data.lineItems.length > 0) {
    amountBeforeTax = parseFloat(
      data.lineItems.reduce((s, i) => s + (Number(i.amount) || i.quantity * i.unitPrice || 0), 0).toFixed(2),
    );
  }

  return {
    vendor: safeValue(data.vendorName),
    vendorAddress: safeValue(data.vendorAddress),
    vendorBankDetails: safeValue(data.bankingDetails),
    invoiceNumber: safeValue(data.invoiceNumber),
    invoiceDate: safeValue(data.invoiceDate),
    dueDate: safeValue(data.dueDate),
    amountBeforeTax: safeValue(amountBeforeTax),
    taxAmount: safeValue(data.taxAmount),
    totalAfterTax: safeValue(data.totalAmount),
    currency: safeValue(data.currency),
    glAccountId: safeValue(data.glAccountId),
    taxCodeId: safeValue(data.taxCodeId),
    itemDescriptionsText: safeValue(data.description),
  };
}

function getInitialFieldErrors(data: NormalizedInvoiceData): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!cleanValue(data.vendor)) errors.vendor = "Vendor name is required";
  if (!cleanValue(data.currency)) errors.currency = "Currency is required";
  if (!cleanValue(data.invoiceNumber)) errors.invoiceNumber = "Invoice number is required";
  if (!cleanValue(data.amountBeforeTax)) errors.amountBeforeTax = "Amount before tax is required";
  if (!cleanValue(data.totalAfterTax)) errors.totalAfterTax = "Total amount is required";
  if (!cleanValue(data.glAccountId)) errors.glAccountId = "GL account is required";
  return errors;
}

// Confidence → tier mapping, restyled onto this app's existing semantic
// status tokens (status-success/warning/danger) instead of the bespoke hex
// ramp InvoiceReviewContent (v1) ports from mobile — same 3 thresholds,
// same functional meaning (what it requires before posting), just mapped to
// this repo's real token system instead of inline hex.
type ConfidenceTier = "success" | "warning" | "danger";

function getConfidenceTier(score: number): ConfidenceTier {
  if (score >= 90) return "success";
  if (score >= 70) return "warning";
  return "danger";
}

const TIER_COPY: Record<ConfidenceTier, { status: string; action: string }> = {
  success: { status: "High confidence", action: "Post to QuickBooks" },
  warning: { status: "Review required", action: "Review & Approve" },
  danger: { status: "Low confidence", action: "Post Manually" },
};

const TIER_CLASSES: Record<ConfidenceTier, { bg: string; border: string; text: string }> = {
  success: { bg: "bg-status-success-bg", border: "border-status-success-border", text: "text-status-success-text" },
  warning: { bg: "bg-status-warning-bg", border: "border-status-warning-border", text: "text-status-warning-text" },
  danger: { bg: "bg-status-danger-bg", border: "border-status-danger-border", text: "text-status-danger-text" },
};

// Collapsible card shell shared by every content section on this screen
// (Invoice Information, Financial Summary, Line Items, Extra Charges) —
// screen-local, matching the precedent of v1's own local SectionHeader.
function SectionCard({
  title,
  badge,
  hint,
  children,
  defaultOpen = true,
  forceOpen,
}: {
  title: string;
  badge?: ReactNode;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  // Pops a collapsed-by-default section back open when it starts containing
  // something the user needs to see right now (a validation error) — e.g.
  // Vendor Details/Financial Summary default closed, but a failed
  // required-field check should still reveal them instead of hiding the bad
  // field behind a closed accordion.
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || !!forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-[var(--space-sm)] border-b border-border bg-page px-[var(--space-md)] py-[var(--space-sm)] text-left"
      >
        <span className="flex flex-wrap items-center gap-[var(--space-sm)]">
          <span className="text-caption font-bold uppercase tracking-wide text-content-secondary">{title}</span>
          {badge}
        </span>
        {open ? (
          <ChevronUp size={16} strokeWidth={2} className="shrink-0 text-content-muted" />
        ) : (
          <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-content-muted" />
        )}
      </button>
      {open && (
        <div className="flex flex-col">
          {hint && <p className="px-[var(--space-md)] pt-[var(--space-sm)] text-tiny text-content-muted">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

// Read-only amount styled exactly like InlineEditField's display state (same
// padding, text-body-sm, regular weight) — so computed Financial Summary
// values look the same as the editable ones they replaced.
function ReadOnlyAmount({ children, className = "text-content-primary" }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex w-full justify-end px-[var(--space-xs)] py-[var(--space-xs)]">
      <span className={`min-w-0 truncate text-body-sm ${className}`}>{children}</span>
    </div>
  );
}

// Label-left/value-right row, matching the read-only invoice detail screen's
// layout but with the value slot taking an editable control.
function FieldRow({
  id,
  label,
  required,
  stacked,
  highlight,
  children,
}: {
  id?: string;
  label: string;
  required?: boolean;
  stacked?: boolean;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24 border-b border-border px-[var(--space-md)] py-[var(--space-sm)] last:border-b-0">
      <div className={stacked ? "flex flex-col gap-[var(--space-xs)]" : "flex items-center justify-between gap-[var(--space-md)]"}>
        <span className={`shrink-0 text-body-sm font-medium text-content-secondary ${highlight ? "self-center" : ""}`}>
          {label}
          {required && <span className="text-status-danger-text"> *</span>}
        </span>
        <div className={stacked ? "w-full" : "min-w-0 flex-1"}>{children}</div>
      </div>
    </div>
  );
}

export function InvoiceReviewContentV2({ invoiceId }: { invoiceId: string }) {
  const dispatch = useAppDispatch();
  const router = useRouter();

  // Only this page's invoice — on back/forward between invoices the store
  // still holds the previous one until the fetch lands, and showing it here
  // displayed (and on the vendor page, could leave) the wrong invoice.
  const invoiceObject = useAppSelector((state) =>
    state.invoice.selectedInvoice?._id === invoiceId ? state.invoice.selectedInvoice : null,
  );
  const fetchError = useAppSelector((state) => state.invoice.error);
  // Declared here (rather than just above their own populating effects
  // further down) so the invoiceId-switch effect below can reset them
  // without referencing a setter before its useState declaration.
  const [originalExtractedTotal, setOriginalExtractedTotal] = useState<number | null>(null);
  const [frozenConfidenceScore, setFrozenConfidenceScore] = useState<number | null>(null);
  const rejecting = useAppSelector((state) => state.invoice.rejecting);
  const posting = useAppSelector((state) => state.invoice.posting);
  const updatingExtractedData = useAppSelector((state) => state.invoice.updatingExtractedData);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const vendorsLoading = useAppSelector((state) => state.quickBooks.vendorsLoading);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const glAccountsLoading = useAppSelector((state) => state.quickBooks.accountsLoading);
  const glAccountsError = useAppSelector((state) => state.quickBooks.accountsError);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const taxCodesLoading = useAppSelector((state) => state.quickBooks.taxCodesLoading);
  const taxCodesError = useAppSelector((state) => state.quickBooks.taxCodesError);
  const realmId = useAppSelector((state) => state.quickBooks.realmId);
  const invoicesLoading = useAppSelector((state) => state.invoice.loading);
  // A vendor resolution belongs to ONE invoice — see vendorSlice.ts. Gated
  // here (as well as cleared in the mount effect below) because the first
  // render happens before that effect runs.
  const vendorResolutionInvoiceId = useAppSelector((state) => state.vendor.forInvoiceId);
  const resolutionIsForThisInvoice = vendorResolutionInvoiceId === invoiceId;
  const createdVendorRaw = useAppSelector((state) => state.vendor.createdVendor);
  const selectedVendorRaw = useAppSelector((state) => state.vendor.selectedVendor);
  const createdVendor = resolutionIsForThisInvoice ? createdVendorRaw : null;
  const selectedVendor = resolutionIsForThisInvoice ? selectedVendorRaw : null;
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const allInvoices = useAppSelector((state) => state.invoice.invoices);

  const [scanLoading, setScanLoading] = useState(true);
  const [scanZoom, setScanZoom] = useState(1);
  const [scanPanelHeight, setScanPanelHeight] = useState(SCAN_PANEL_DEFAULT_HEIGHT);
  const scanResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  // Remembers the height to restore to when un-maximizing — whatever the
  // panel was at (default, or a manual drag) right before the maximize
  // button was clicked, not always SCAN_PANEL_DEFAULT_HEIGHT.
  const preMaximizeHeightRef = useRef(SCAN_PANEL_DEFAULT_HEIGHT);
  const isScanPanelMaximized = scanPanelHeight >= SCAN_PANEL_MAX_HEIGHT;
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const quickActionsRef = useRef<HTMLDivElement>(null);

  // Pointer capture (not document-level listeners) so the drag keeps
  // tracking the handle even when the cursor passes over the PDF <iframe>
  // inside the panel — an iframe has its own document and would otherwise
  // swallow mousemove/pointermove once the cursor crosses into it.
  const handleScanResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scanResizeRef.current = { startY: event.clientY, startHeight: scanPanelHeight };
  };

  const handleScanResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scanResizeRef.current) return;
    const delta = event.clientY - scanResizeRef.current.startY;
    const next = Math.min(
      SCAN_PANEL_MAX_HEIGHT,
      Math.max(SCAN_PANEL_MIN_HEIGHT, scanResizeRef.current.startHeight + delta),
    );
    setScanPanelHeight(next);
  };

  const handleScanResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    scanResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleToggleScanPanelMaximize = () => {
    if (isScanPanelMaximized) {
      setScanPanelHeight(preMaximizeHeightRef.current);
    } else {
      preMaximizeHeightRef.current = scanPanelHeight;
      setScanPanelHeight(SCAN_PANEL_MAX_HEIGHT);
    }
  };

  // Sticky header's real rendered height (varies with wrapping at narrow
  // widths) — the aside panel sticks right below it instead of at a fixed
  // token offset, so the header can never cover the top of the panel as the
  // page scrolls.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeaderHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Drag-to-resize width for the right-hand panel (Scanned Copy, Vendor
  // Details, Item Description Notes, Status History all live in this one
  // column, so widening it widens/aligns all of them together).
  const [asideWidth, setAsideWidth] = useState(ASIDE_DEFAULT_WIDTH);
  const asideResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleAsideResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    asideResizeRef.current = { startX: event.clientX, startWidth: asideWidth };
  };

  const handleAsideResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!asideResizeRef.current) return;
    // The panel is on the right, so dragging left (negative clientX delta)
    // should widen it.
    const delta = asideResizeRef.current.startX - event.clientX;
    const next = Math.min(ASIDE_MAX_WIDTH, Math.max(ASIDE_MIN_WIDTH, asideResizeRef.current.startWidth + delta));
    setAsideWidth(next);
  };

  const handleAsideResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    asideResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    dispatch(clearVendorResolutionForOtherInvoice(invoiceId));
    dispatch(getInvoiceDetails(invoiceId));
    // Pull the full invoice list so the pre-post duplicate-number check below
    // can compare against every invoice this tab knows about — skipped when
    // already loaded/loading so opening invoice after invoice doesn't
    // re-fetch the same list every single time (this, plus the same gap in
    // the vendors/accounts/taxCodes effect below, was still tripping the
    // global rate limiter on rapid invoice navigation even after
    // GlobalSearchBar was fixed).
    if (allInvoices.length === 0 && !invoicesLoading) dispatch(getInvoices());
    // A genuine invoice switch (not a same-invoice Save refresh) — let
    // originalExtractedTotal/frozenConfidenceScore be captured fresh for
    // whichever invoice loads next.
    setOriginalExtractedTotal(null);
    setFrozenConfidenceScore(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // A bad/stale/deleted invoiceId (e.g. an old bookmarked link, or the
  // invoice was deleted from another tab) — bounce back to the list instead
  // of leaving the user stuck on this page staring at "Invoice not found".
  // Same pattern as InvoiceDetailContentV2.
  // Keyed on THIS invoice's detail fetch failing, not the shared `error` —
  // a stale error from another invoice thunk would otherwise bounce a valid
  // invoice back to the list before its own fetch even ran.
  const detailsFailed = useAppSelector((state) => state.invoice.invoiceDetailsErrorFor === invoiceId);
  useEffect(() => {
    if (!detailsFailed || invoiceObject) return;
    showToast(typeof fetchError === "string" ? fetchError : "This invoice could not be found.", "error");
    router.replace("/invoices");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchError is only the toast text
  }, [detailsFailed, invoiceObject, router]);

  useEffect(() => {
    if (!accessToken) return;
    // Sequential, not parallel — see InvoiceReviewContent.tsx (v1) for why:
    // near-simultaneous requests sharing one QuickBooks connection can race a
    // backend token refresh. Each one only fires if that list is BOTH empty
    // and not already loading, same guard as GlobalSearchBar — otherwise
    // every invoice opened re-fetches all three lists again even though
    // they're already in the store.
    (async () => {
      if (vendors.length === 0 && !vendorsLoading) await dispatch(fetchQuickBooksVendors({ accessToken }));
      if (glAccounts.length === 0 && !glAccountsLoading) await dispatch(fetchQuickBooksAccounts({ accessToken }));
      if (taxCodes.length === 0 && !taxCodesLoading) await dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!quickActionsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (quickActionsRef.current && !quickActionsRef.current.contains(event.target as Node)) {
        setQuickActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [quickActionsOpen]);

  const rawData = invoiceObject?.extractedData || {};
  // Reachable for two flows: a pending invoice's actual review (reject/post),
  // and the "edit" pencil on an already-posted invoice's detail page — the
  // latter just patches fields via updateInvoiceExtractedData.
  const invoiceType = resolveInvoiceDetailType(invoiceObject?.postedStatus);
  const isPendingReview = invoiceType === "pending";
  const confidenceScore = Number.isFinite(Number(invoiceObject?.confidenceScore))
    ? Math.max(0, Math.min(100, Number(invoiceObject?.confidenceScore)))
    : 0;
  // Was `useState(confidenceScore)` — a lazy initializer that runs on this
  // component's very first render, which on a hard/direct navigation to this
  // URL (store empty, invoiceObject not loaded yet) froze at 0 forever,
  // permanently misrendering the confidence tier as "danger" (red) even once
  // the real score arrived. A soft client-side navigation (e.g. the Edit
  // button on the detail page for the same invoice) never showed this,
  // because invoiceObject was already populated in the store by the time
  // this component mounted. Same bug class, same fix, as
  // originalExtractedTotal above: seed null, capture once real data lands.
  useEffect(() => {
    if (frozenConfidenceScore === null && invoiceObject?.confidenceScore != null) {
      setFrozenConfidenceScore(confidenceScore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceObject, frozenConfidenceScore]);
  const tier = useMemo(() => getConfidenceTier(frozenConfidenceScore ?? 0), [frozenConfidenceScore]);
  const statusHistory = invoiceObject?.statusHistory || [];
  const latestStatus = statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : null;
  const postingReason = latestStatus?.reason || "";
  const vendorResolutionRequired = isPendingReview && postingReason.toLowerCase().includes("vendor");
  const vendorIsResolved = !!(selectedVendor || createdVendor);
  const reasonDisplay = useMemo(() => translateInvoiceReason(postingReason), [postingReason]);
  const [showTechnicalReason, setShowTechnicalReason] = useState(false);
  const glAccountsErrorDisplay = useMemo(() => translateInvoiceReason(glAccountsError), [glAccountsError]);
  const [showGlAccountsErrorDetails, setShowGlAccountsErrorDetails] = useState(false);
  const taxCodesErrorDisplay = useMemo(() => translateInvoiceReason(taxCodesError), [taxCodesError]);
  const [showTaxCodesErrorDetails, setShowTaxCodesErrorDetails] = useState(false);
  const lastModifiedByName = getUserDisplayName(latestStatus?.changedBy);

  const [invoice, setInvoice] = useState<NormalizedInvoiceData>(() => normalizeInvoiceData(rawData));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(() =>
    getInitialFieldErrors(normalizeInvoiceData(rawData)),
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(() => withComputedLineItemAmounts(rawData.lineItems || []));
  const [extraCharges, setExtraCharges] = useState<ExtraCharge[]>(() => rawData.extraCharges || []);
  const [discounts, setDiscounts] = useState<Discount[]>(() => rawData.discounts || []);
  // Distinguishes "this invoice never had line items" (nothing to derive
  // Before Tax from — leave whatever was extracted/typed alone) from "line
  // items existed and the user just deleted the last one" (Before Tax should
  // follow them back down to 0, not get stuck at its last-synced value).
  // Reset whenever the underlying invoice changes, alongside lineItems itself.
  const hadLineItemsRef = useRef((rawData.lineItems?.length ?? 0) > 0);
  // Enter in a row's description jumps straight to that row's next field
  // (line item → unit price, extra charge/discount → amount). Keyed by row index.
  const unitPriceFieldRefs = useRef<Record<number, InlineEditFieldHandle | null>>({});
  const extraChargeAmountFieldRefs = useRef<Record<number, InlineEditFieldHandle | null>>({});
  const discountAmountFieldRefs = useRef<Record<number, InlineEditFieldHandle | null>>({});

  // The list/dashboard pre-seed selectedInvoice so this form is editable
  // immediately; getInvoiceDetails then replaces it with the same invoice's
  // fresh copy. Applying that copy over edits made in the meantime wiped them,
  // so a refresh of the SAME invoice only resets an untouched form.
  const resetForInvoiceIdRef = useRef<string | null>(null);
  const userEditedRef = useRef(false);

  // Full reset only when the underlying invoice itself changes — see
  // InvoiceReviewContent.tsx (v1) for why this deliberately does NOT re-run
  // when selectedVendor/createdVendor change on their own.
  useEffect(() => {
    const currentId: string | null = invoiceObject?._id ?? null;
    if (currentId && currentId === resetForInvoiceIdRef.current && userEditedRef.current) return;
    resetForInvoiceIdRef.current = currentId;
    userEditedRef.current = false;
    const normalized = normalizeInvoiceData(invoiceObject?.extractedData || {});
    if (selectedVendor?.displayName) normalized.vendor = selectedVendor.displayName;
    else if (createdVendor?.name) normalized.vendor = createdVendor.name;
    if (!normalized.glAccountId) {
      normalized.glAccountId = selectedVendor?.glAccountId || createdVendor?.glAccountId || "";
    }
    if (!normalized.taxCodeId) {
      normalized.taxCodeId = selectedVendor?.taxCodeId || createdVendor?.taxCodeId || "";
    }
    setInvoice(normalized);
    setFieldErrors(getInitialFieldErrors(normalized));
    setLineItems(
      withLineDefaults(
        withComputedLineItemAmounts(invoiceObject?.extractedData?.lineItems || []),
        normalized.glAccountId,
        normalized.taxCodeId,
      ),
    );
    setExtraCharges(invoiceObject?.extractedData?.extraCharges || []);
    setDiscounts(invoiceObject?.extractedData?.discounts || []);
    hadLineItemsRef.current = (invoiceObject?.extractedData?.lineItems?.length ?? 0) > 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceObject]);

  // Vendor picked/resolved after the invoice already loaded — patch only the
  // vendor-derived fields onto whatever's currently in the form.
  useEffect(() => {
    if (!selectedVendor && !createdVendor) return;
    const merged = {
      ...invoice,
      vendor: selectedVendor?.displayName || createdVendor?.name || invoice.vendor,
      glAccountId: invoice.glAccountId || selectedVendor?.glAccountId || createdVendor?.glAccountId || "",
      taxCodeId: invoice.taxCodeId || selectedVendor?.taxCodeId || createdVendor?.taxCodeId || "",
    };
    setInvoice(merged);
    setFieldErrors(getInitialFieldErrors(merged));
    // The vendor's GL/tax may only just have become known — carry them down
    // to any line that doesn't have its own yet.
    setLineItems((prev) => withLineDefaults(prev, merged.glAccountId, merged.taxCodeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVendor, createdVendor]);

  // Every user edit goes through these, never the raw setters, so the reset
  // effect above can tell an edited form from an untouched one.
  const editInvoice: typeof setInvoice = (value) => {
    userEditedRef.current = true;
    setInvoice(value);
  };
  const editLineItems: typeof setLineItems = (value) => {
    userEditedRef.current = true;
    setLineItems(value);
  };
  const editExtraCharges: typeof setExtraCharges = (value) => {
    userEditedRef.current = true;
    setExtraCharges(value);
  };
  const editDiscounts: typeof setDiscounts = (value) => {
    userEditedRef.current = true;
    setDiscounts(value);
  };

  const updateField = (key: keyof NormalizedInvoiceData, value: string) => {
    editInvoice((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const updateLineItem = (index: number, key: "description" | "quantity" | "unitPrice", value: string) => {
    editLineItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (key === "description") return { ...item, description: value };
        const updated = { ...item, [key]: Number(value) || 0 };
        // Amount is always quantity × unit price — never independently typed
        // or trusted from the raw extraction, which can disagree with it
        // (the LLM's own "amount" field is a separate guess that doesn't
        // always match qty×unitPrice).
        return { ...updated, amount: computeLineItemAmount(updated.quantity, updated.unitPrice) };
      }),
    );
  };

  const updateLineItemGlAccount = (index: number, glAccountId: string) => {
    editLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, glAccountId: glAccountId || undefined } : item)));
  };

  // "" = inherit the invoice-level (vendor) tax code.
  const updateLineItemTaxCode = (index: number, taxCodeIdValue: string) => {
    editLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, taxCodeId: taxCodeIdValue || null } : item)));
  };

  const addLineItem = () => {
    editLineItems((prev) => [
      ...prev,
      ...withLineDefaults(
        [{ description: "", quantity: 1, unitPrice: 0, amount: 0 }],
        cleanValue(invoice.glAccountId),
        cleanValue(invoice.taxCodeId),
      ),
    ]);
  };

  const duplicateLineItem = (index: number) => {
    editLineItems((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, { ...prev[index] });
      return next;
    });
  };

  const removeLineItem = (index: number) => {
    editLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExtraChargeDescription = (index: number, value: string) => {
    editExtraCharges((prev) => prev.map((c, i) => (i === index ? { ...c, description: value } : c)));
  };

  const updateExtraChargeAmount = (index: number, value: string) => {
    editExtraCharges((prev) => prev.map((c, i) => (i === index ? { ...c, amount: Number(value) || 0 } : c)));
  };

  const addExtraCharge = () => {
    editExtraCharges((prev) => [...prev, { description: "", amount: 0, taxCodeId: null }]);
  };

  const duplicateExtraCharge = (index: number) => {
    editExtraCharges((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, { ...prev[index] });
      return next;
    });
  };

  const removeExtraCharge = (index: number) => {
    editExtraCharges((prev) => prev.filter((_, i) => i !== index));
  };

  const updateDiscountDescription = (index: number, value: string) => {
    editDiscounts((prev) => prev.map((d, i) => (i === index ? { ...d, description: value } : d)));
  };

  const updateDiscountAmount = (index: number, value: string) => {
    // Always stored/sent as a positive magnitude — see the Discount type comment.
    editDiscounts((prev) => prev.map((d, i) => (i === index ? { ...d, amount: Math.abs(Number(value) || 0) } : d)));
  };

  const addDiscount = () => {
    editDiscounts((prev) => [...prev, { description: "", amount: 0 }]);
  };

  const duplicateDiscount = (index: number) => {
    editDiscounts((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, { ...prev[index] });
      return next;
    });
  };

  const removeDiscount = (index: number) => {
    editDiscounts((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Final amount: always computed, never independently typed ───────────
  // QuickBooks has no separate "total" input on a Bill — its total is always
  // the sum of the Line entries buildBillPayload (backend) posts, and those
  // lines come from the line items. So the pre-tax base can only ever
  // legitimately be the line items' own sum — never amountBeforeTax as a
  // fallback, since that's a separately-extracted guess that can disagree
  // with the line items. With no line items at all there is nothing to base
  // a real Bill on yet, so the base is 0 rather than silently trusting an
  // unrelated field.
  const hasLineItemsForTotal = lineItems.length > 0;
  const lineItemsSum = useMemo(
    () => parseFloat(lineItems.reduce((s, item) => s + (Number(item.amount) || 0), 0).toFixed(2)),
    [lineItems],
  );
  // Pulled out of computedTotal so the Financial Summary can display them as
  // their own rows, not just fold silently into the Total.
  const extraChargesSum = useMemo(
    () => parseFloat(extraCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0).toFixed(2)),
    [extraCharges],
  );
  const discountsSum = useMemo(
    () => parseFloat(discounts.reduce((s, d) => s + (Number(d.amount) || 0), 0).toFixed(2)),
    [discounts],
  );
  // Tax is computed from line items × their QuickBooks tax-code rates (see
  // computeLineItemsTax) — no longer the AI-extracted taxAmount, which is
  // exactly as fragile as the extracted total (a missed line or value throws
  // it off). invoice.taxAmount is left untouched as the extracted reference.
  const taxCodeById = useMemo(() => new Map(taxCodes.map((code) => [getTaxCodeId(code), code])), [taxCodes]);
  const lineItemsTax = useMemo(
    () => computeLineItemsTax(lineItems, cleanValue(invoice.taxCodeId), taxCodeById),
    [lineItems, invoice.taxCodeId, taxCodeById],
  );
  const computedTax = lineItemsTax.tax;

  // Flags the invoice-level GL/tax dropdowns as "mixed" when line items don't
  // all resolve to the same effective code (a line's own override, else the
  // invoice-level default) — since selecting a value there overwrites every
  // line, the field showing one specific code as if it applied everywhere
  // would be misleading while lines actually differ.
  const glAccountsMixedAcrossLines = useMemo(() => {
    if (lineItems.length < 2) return false;
    const ids = new Set(lineItems.map((item) => item.glAccountId || cleanValue(invoice.glAccountId)));
    return ids.size > 1;
  }, [lineItems, invoice.glAccountId]);
  const taxCodesMixedAcrossLines = useMemo(() => {
    if (lineItems.length < 2) return false;
    const ids = new Set(lineItems.map((item) => item.taxCodeId || cleanValue(invoice.taxCodeId)));
    return ids.size > 1;
  }, [lineItems, invoice.taxCodeId]);

  const computedTotal = useMemo(() => {
    const preTaxBase = hasLineItemsForTotal ? lineItemsSum : 0;
    // Never below 0 — e.g. discounts larger than everything else. A Bill
    // can't have a negative total.
    return Math.max(0, parseFloat((preTaxBase + computedTax + extraChargesSum - discountsSum).toFixed(2)));
  }, [hasLineItemsForTotal, lineItemsSum, computedTax, extraChargesSum, discountsSum]);

  // The AI's own extracted grand total, frozen at load — kept only as a
  // reference to compare against computedTotal (both tax-inclusive, so this
  // is the correct apples-to-apples pairing), never sent anywhere.
  //
  // NOT a useState(() => ...) lazy initializer — that runs on this
  // component's very FIRST render, which happens before invoiceObject has
  // loaded (getInvoiceDetails is dispatched in a separate effect and
  // resolves later), so it would freeze at 0 forever and totalMismatch would
  // never fire. Captured instead the first time real data actually arrives,
  // and reset back to null when invoiceId itself changes (the invoiceId-only
  // effect below) — but NOT on every invoiceObject update, since a Save
  // re-fetches the same invoice and would otherwise re-freeze this to
  // whatever we ourselves just posted, defeating its purpose as a reference.
  useEffect(() => {
    if (originalExtractedTotal === null && invoiceObject?.extractedData?.totalAmount != null) {
      setOriginalExtractedTotal(Number(invoiceObject.extractedData.totalAmount) || 0);
    }
  }, [invoiceObject, originalExtractedTotal]);
  const totalMismatch =
    originalExtractedTotal !== null &&
    originalExtractedTotal > 0 &&
    Math.abs(computedTotal - originalExtractedTotal) > 0.01;

  // Keeps invoice.totalAfterTax (what's displayed and what buildExtractedDataPayload
  // sends) always equal to computedTotal, for every mutation (line items
  // included — a real gap the old per-handler recalculate calls had).
  useEffect(() => {
    setInvoice((prev) => {
      const nextValue = String(computedTotal);
      return prev.totalAfterTax === nextValue ? prev : { ...prev, totalAfterTax: nextValue };
    });
    setFieldErrors((prev) => {
      if (!prev.totalAfterTax) return prev;
      const updated = { ...prev };
      delete updated.totalAfterTax;
      return updated;
    });
  }, [computedTotal]);

  // Before Tax is always the line items' own sum once line items exist —
  // same reasoning as Amount (qty × unit price) and Total above: line items
  // are the source of truth, so nothing independently typed here should be
  // able to drift away from what they actually add up to.
  //
  // Without line items there's nothing to derive it from — BUT that "no
  // line items" state means two different things depending on how it was
  // reached: an invoice that never had any (nothing to sync, leave whatever
  // was extracted/typed alone) vs. one where the user just deleted the last
  // remaining line item (Before Tax should follow them back down to 0, not
  // stay stuck at whatever it last synced to). hadLineItemsRef tells the two
  // apart.
  useEffect(() => {
    if (hasLineItemsForTotal) {
      hadLineItemsRef.current = true;
    } else if (!hadLineItemsRef.current) {
      return;
    }
    setInvoice((prev) => {
      const nextValue = String(lineItemsSum);
      return prev.amountBeforeTax === nextValue ? prev : { ...prev, amountBeforeTax: nextValue };
    });
    setFieldErrors((prev) => {
      if (!prev.amountBeforeTax) return prev;
      const updated = { ...prev };
      delete updated.amountBeforeTax;
      return updated;
    });
  }, [hasLineItemsForTotal, lineItemsSum]);

  const resolvedGlAccountName = useMemo(
    () => glAccounts.find((acc) => acc.qbAccountId === invoice.glAccountId)?.name || "",
    [glAccounts, invoice.glAccountId],
  );

  const resolvedTaxCodeName = useMemo(() => {
    const match = taxCodes.find((code) => getTaxCodeId(code) === invoice.taxCodeId);
    return match ? getTaxCodeLabel(match) : "";
  }, [taxCodes, invoice.taxCodeId]);

  // Label reflects the actual codes applied, not a back-derived tax÷base ratio.
  // Tax rows come straight from the QuickBooks rates actually charged (see
  // computeLineItemsTax's breakdown) — e.g. "GST (ITC) · 5%" and
  // "PST (BC) Purchase · 7%" as separate rows, the way invoices print them.
  const taxBreakdown = lineItemsTax.breakdown;
  const taxRateRowLabel = (entry: { name: string; rate: number }) => `${entry.name} · ${formatTaxRate(entry.rate)}`;
  const taxTotalRowLabel =
    taxBreakdown.length === 1 ? `Tax · ${taxRateRowLabel(taxBreakdown[0])}` : taxBreakdown.length > 1 ? "Total Tax" : "Tax (0%)";
  // Before Tax is now always kept in sync with the line items' own sum (see
  // the effect above), so the only independent thing left to cross-check is
  // the computed total against what the scanned invoice itself says its
  // total is (totalMismatch above).
  const isBalanced = !totalMismatch;

  const previewUrl = invoiceObject?.file?.s3Url || (invoiceObject as unknown as { s3Url?: string })?.s3Url;
  const previewMimeType = invoiceObject?.file?.mimeType || "";
  const isPdf = previewMimeType.includes("pdf") || (previewUrl ?? "").toLowerCase().includes(".pdf");
  const driveFileUrl = invoiceObject?.googleDrive?.fileUrl;
  const previewHref = previewUrl
    ? `/invoices/preview?url=${encodeURIComponent(previewUrl)}&mimeType=${encodeURIComponent(previewMimeType)}`
    : null;

  const handlePrint = () => {
    if (!previewUrl) return;
    const win = window.open(previewUrl, "_blank");
    if (win) {
      window.setTimeout(() => {
        try {
          win.print();
        } catch {
          // Cross-origin viewer may not accept a print() call this way —
          // the tab is still open for the user to print manually.
        }
      }, 800);
    }
  };

  const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const vendor = vendors.find((v) => v._id === event.target.value);
    if (!vendor) return;
    updateField("vendor", vendor.displayName);
    dispatch(
      setSelectedVendor({
        forInvoiceId: invoiceId,
        _id: vendor._id,
        displayName: vendor.displayName,
        qbVendorId: vendor.qbVendorId,
        email: null,
        phone: null,
        address: null,
        glAccountId: vendor.glAccountId ?? null,
        taxCodeId: vendor.taxCodeId ?? null,
      }),
    );
  };

  // Same overwrite-all-lines rule as handleGlAccountChange below.
  const handleTaxCodeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextTaxCodeId = event.target.value;
    updateField("taxCodeId", nextTaxCodeId);
    editLineItems((prev) => prev.map((item) => ({ ...item, taxCodeId: nextTaxCodeId || null })));
  };

  const handleGlAccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const account = glAccounts.find((acc) => acc.qbAccountId === event.target.value);
    if (!account) return;
    editInvoice((prev) => ({ ...prev, glAccountId: account.qbAccountId }));
    // Invoice-level GL is the default for every line — changing it
    // deliberately overwrites all lines, including ones changed by hand.
    editLineItems((prev) => prev.map((item) => ({ ...item, glAccountId: account.qbAccountId })));
    setFieldErrors((prev) => {
      if (!prev.glAccountId) return prev;
      const updated = { ...prev };
      delete updated.glAccountId;
      return updated;
    });
  };

  const validateQuickBooksFields = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!cleanValue(invoice.vendor)) errors.vendor = "Vendor name is required";
    if (!cleanValue(invoice.currency)) errors.currency = "Currency is required";
    if (!cleanValue(invoice.invoiceNumber)) errors.invoiceNumber = "Invoice number is required";
    if (!cleanValue(invoice.amountBeforeTax)) errors.amountBeforeTax = "Amount before tax is required";
    if (!cleanValue(invoice.totalAfterTax)) errors.totalAfterTax = "Total amount is required";
    if (!cleanValue(invoice.glAccountId)) errors.glAccountId = "GL account is required";
    return errors;
  };

  const isPostDisabled = posting || rejecting || (vendorResolutionRequired && !vendorIsResolved);
  const isRejectDisabled = posting || rejecting;
  const isSaveDisabled = updatingExtractedData || posting || rejecting;

  const buildExtractedDataPayload = () => ({
    currency: cleanValue(invoice.currency),
    invoiceNumber: cleanValue(invoice.invoiceNumber),
    invoiceDate: cleanValue(invoice.invoiceDate) || null,
    dueDate: cleanValue(invoice.dueDate) || null,
    amountBeforeTax: Number(invoice.amountBeforeTax) || 0,
    // Straight from the computed values rather than their synced copies on
    // `invoice` — what's shown on screen is exactly what gets saved/posted.
    taxAmount: computedTax,
    totalAmount: computedTotal,
    lineItems,
    // Extra charges are always non-taxable (backend posts them as NON) —
    // clear any tax code left over from before that rule.
    extraCharges: extraCharges.map((charge) => ({ ...charge, taxCodeId: null })),
    discounts,
    description: cleanValue(invoice.itemDescriptionsText) || null,
    vendorAddress: cleanValue(invoice.vendorAddress) || null,
    bankingDetails: cleanValue(invoice.vendorBankDetails) || null,
    glAccountId: cleanValue(invoice.glAccountId) || null,
    taxCodeId: cleanValue(invoice.taxCodeId) || null,
  });

  const handleReject = async () => {
    const confirmed = await confirmDialog({
      title: "Reject this invoice?",
      message: "It will be permanently moved to the Failed section and cannot be undone.",
      confirmLabel: "Reject",
      tone: "destructive",
    });
    if (!confirmed) return;

    const result = await dispatch(rejectInvoice({ invoiceId }));
    if (rejectInvoice.fulfilled.match(result)) {
      showToast("The invoice has been moved to the Failed section.", "success");
      router.push("/invoices?type=pending");
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to reject the invoice.", "error");
    }
  };

  const submitToQuickBooks = async () => {
    const vendorId = selectedVendor?._id || selectedVendor?.qbVendorId || invoiceObject?.vendor?.vendorDbId || "";

    if (!vendorId) {
      showToast("Could not find vendor ID. Please resolve the vendor first.", "error");
      return;
    }

    const result = await dispatch(
      postInvoiceToQuickBooks({
        invoiceId,
        vendorId,
        extractedData: { vendorName: cleanValue(invoice.vendor), ...buildExtractedDataPayload() },
      }),
    );

    if (postInvoiceToQuickBooks.fulfilled.match(result)) {
      showToast("Invoice posted to QuickBooks successfully.", "success");
      router.push("/invoices?type=pending");
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(
        typeof payload === "string" ? payload : payload?.message || "Failed to post invoice to QuickBooks.",
        "error",
      );
    }
  };

  const handlePrimaryAction = async () => {
    const errors = validateQuickBooksFields();
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      setFieldErrors(errors);
      showToast(errors[errorKeys[0]] || "Please fill in the required fields.", "error");
      // The target field may live inside a section that defaults closed
      // (Financial Summary/Vendor Details) — forceOpen re-renders it open on
      // the same tick, so wait a frame for that DOM update before scrolling.
      requestAnimationFrame(() => {
        document.getElementById(`field-${errorKeys[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (vendorResolutionRequired && !vendorIsResolved) {
      const confirmed = await confirmDialog({
        title: "Vendor not registered",
        message: "This vendor is not registered in QuickBooks. Resolve the vendor now?",
        confirmLabel: "Resolve vendor",
      });
      if (confirmed) setVendorDialogOpen(true);
      return;
    }

    // Duplicate-invoice warning — see submitToQuickBooks's sibling in
    // InvoiceReviewContent.tsx (v1) for the full rationale (QuickBooks
    // rejects duplicate invoice numbers per vendor; the scan pipeline isn't
    // transactional).
    let candidates = allInvoices;
    try {
      const refreshed = await dispatch(getInvoices());
      if (getInvoices.fulfilled.match(refreshed) && Array.isArray(refreshed.payload)) {
        candidates = refreshed.payload as typeof allInvoices;
      }
    } catch {
      // keep the cached list
    }

    const sameNumberForVendor = (inv: (typeof allInvoices)[number]) =>
      inv._id !== invoiceId &&
      Boolean(inv.quickbooks?.billId) &&
      String(inv.extractedData?.vendorName ?? "").trim().toLowerCase() ===
        String(invoice.vendor ?? "").trim().toLowerCase() &&
      String(inv.extractedData?.invoiceNumber ?? "").trim().toLowerCase() ===
        String(invoice.invoiceNumber ?? "").trim().toLowerCase() &&
      String(invoice.invoiceNumber ?? "").trim() !== "";

    const existingBill = candidates.find(sameNumberForVendor);

    if (existingBill) {
      const confirmed = await confirmDialog({
        title: "Possible duplicate invoice",
        message:
          `Invoice #${invoice.invoiceNumber} for ${invoice.vendor} already exists in QuickBooks as bill ` +
          `#${existingBill.quickbooks?.billId} (${formatDetailAmount(Number(existingBill.extractedData?.totalAmount))}).` +
          (Math.round(Number(existingBill.extractedData?.totalAmount) * 100) !==
          Math.round(Number(invoice.totalAfterTax) * 100)
            ? ` This one is ${formatDetailAmount(Number(invoice.totalAfterTax))}, so the amounts differ — check which is correct.`
            : "") +
          " Posting anyway may create a duplicate bill.",
        confirmLabel: "Post anyway",
        cancelLabel: "Cancel",
        tone: "destructive",
      });
      if (confirmed !== true) return;
      await submitToQuickBooks();
      return;
    }

    const confirmed = await confirmDialog({
      title: "Post to QuickBooks?",
      message: "Please verify all details are correct before confirming.",
      confirmLabel: "Post invoice",
    });
    if (confirmed === true) submitToQuickBooks();
  };

  // Real "save without posting" action for a pending invoice — patches
  // extractedData in place via the same thunk the edit-mode Save Changes
  // button below uses, without touching postedStatus, so the invoice stays
  // pending. Genuinely new relative to v1 (which only offered Reject/Post
  // for a pending invoice) but backed entirely by the existing thunk.
  const handleQuickSave = async () => {
    const errors = validateQuickBooksFields();
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      setFieldErrors(errors);
      showToast(errors[errorKeys[0]] || "Please fill in the required fields.", "error");
      // The target field may live inside a section that defaults closed
      // (Financial Summary/Vendor Details) — forceOpen re-renders it open on
      // the same tick, so wait a frame for that DOM update before scrolling.
      requestAnimationFrame(() => {
        document.getElementById(`field-${errorKeys[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    const result = await dispatch(
      updateInvoiceExtractedData({ invoiceId, extractedData: buildExtractedDataPayload() }),
    );

    if (updateInvoiceExtractedData.fulfilled.match(result)) {
      showToast("Draft saved.", "success");
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to save changes.", "error");
    }
  };

  // Edit path for an already-posted (auto/manual) invoice, reached via the
  // detail page's pencil button — patches fields in place rather than
  // re-posting. Never sends vendorName (tied to the already-linked QB
  // vendor record).
  const handleSaveChanges = async () => {
    const errors = validateQuickBooksFields();
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      setFieldErrors(errors);
      showToast(errors[errorKeys[0]] || "Please fill in the required fields.", "error");
      // The target field may live inside a section that defaults closed
      // (Financial Summary/Vendor Details) — forceOpen re-renders it open on
      // the same tick, so wait a frame for that DOM update before scrolling.
      requestAnimationFrame(() => {
        document.getElementById(`field-${errorKeys[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    const result = await dispatch(
      updateInvoiceExtractedData({ invoiceId, extractedData: buildExtractedDataPayload() }),
    );

    if (updateInvoiceExtractedData.fulfilled.match(result)) {
      showToast("Invoice updated and synced to QuickBooks.", "success");
      router.push(`/invoices/${invoiceId}`);
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to update invoice.", "error");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    // An explicit refresh means "show me the server's copy" — let the reset
    // effect apply it even over unsaved edits.
    userEditedRef.current = false;
    await dispatch(getInvoiceDetails(invoiceId));
    setRefreshing(false);
    setQuickActionsOpen(false);
    showToast("Invoice data refreshed.", "success");
  };

  if (!invoiceObject) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  const currencyForAmount = cleanValue(invoice.currency);
  const totalAmountDisplay = formatDetailAmount(invoice.totalAfterTax || null, currencyForAmount);

  // First error relevant to the Invoice Information section, in the order
  // its fields actually appear — shown on the accordion header itself so
  // it's visible even collapsed, instead of making the user expand the
  // section (and scroll past everything above it) just to discover there's
  // a problem. Field-validation errors take priority over "couldn't load
  // the dropdown options" errors, since fixing the field is the more
  // actionable of the two.
  const invoiceInfoTopError =
    fieldErrors.invoiceNumber ||
    fieldErrors.currency ||
    fieldErrors.glAccountId ||
    glAccountsErrorDisplay?.message ||
    taxCodesErrorDisplay?.message ||
    null;

  // `fieldErrors.vendor` only fires when the vendor NAME text is blank —
  // doesn't cover the far more common case of a vendor name that extracted
  // fine but was never matched/created against an actual QuickBooks vendor
  // record (the "+ Resolve Vendor" prompt above, gated the same way by
  // vendorResolutionRequired/vendorIsResolved). Check that first since it's
  // the one the dropdown in this section actually reflects.
  const vendorInfoTopError =
    (vendorResolutionRequired && !vendorIsResolved ? "Vendor not resolved" : null) || fieldErrors.vendor || null;

  return (
    <div className="w-full">
      {/* Header — kept short (py-xs/py-sm, not the roomier p-md/p-lg the rest
          of the screen uses) so it reads as a slim action bar rather than
          eating vertical space above the fold. */}
      <div
        ref={headerRef}
        className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-[var(--space-sm)] border-b border-border bg-page px-[var(--space-md)] py-[var(--space-xs)] sm:px-[var(--space-lg)] sm:py-[var(--space-sm)]"
      >
        <div className="flex items-center gap-[var(--space-sm)]">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-[var(--space-xs)] rounded-md px-[var(--space-xs)] py-[var(--space-xs)] text-body-sm font-bold text-content-secondary hover:bg-surface-alt hover:text-content-primary"
          >
            <ChevronLeft size={18} strokeWidth={2.25} />
            Back
          </button>
          <span className="hidden text-border-strong sm:inline">|</span>
          <h1 className="hidden text-caption font-bold uppercase tracking-wide text-content-secondary sm:inline">
            {isPendingReview ? "Invoice Review" : "Edit Invoice"}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--space-xs)]">
          {isPendingReview && (
            <div ref={quickActionsRef} className="relative">
              <button
                type="button"
                onClick={() => setQuickActionsOpen((v) => !v)}
                className="inline-flex h-9 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-bold text-content-primary hover:bg-surface-alt"
              >
                <Zap size={14} strokeWidth={2.25} className="text-accent" />
                Quick Actions
                <ChevronDown size={14} strokeWidth={2.25} />
              </button>
              {quickActionsOpen && (
                <div className="absolute right-0 z-20 mt-[var(--space-xs)] w-56 rounded-md border border-border bg-surface py-[var(--space-xs)] shadow-lg">
                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    disabled={refreshing}
                    className="flex w-full items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-left text-body-sm text-content-primary hover:bg-surface-alt disabled:opacity-50"
                  >
                    <RefreshCw size={14} strokeWidth={2} className={refreshing ? "animate-spin" : ""} />
                    {refreshing ? "Refreshing…" : "Refresh invoice data"}
                  </button>
                  {vendorResolutionRequired && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickActionsOpen(false);
                        setVendorDialogOpen(true);
                      }}
                      className="flex w-full items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-left text-body-sm text-content-primary hover:bg-surface-alt"
                    >
                      <Building2 size={14} strokeWidth={2} />
                      Resolve vendor
                    </button>
                  )}
                  {driveFileUrl && (
                    <a
                      href={driveFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setQuickActionsOpen(false)}
                      className="flex w-full items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-left text-body-sm text-content-primary hover:bg-surface-alt"
                    >
                      <BrandIcon name="google-drive" size={14} />
                      Open in Google Drive
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {isPendingReview && (
            <button
              type="button"
              onClick={() => void handleQuickSave()}
              disabled={isSaveDisabled}
              className="inline-flex h-9 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-bold text-content-primary hover:bg-surface-alt disabled:opacity-45"
            >
              <Save size={14} strokeWidth={2.25} />
              {updatingExtractedData ? "Saving…" : "Save"}
            </button>
          )}

          {isPendingReview ? (
            <>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={isRejectDisabled}
                className="h-9 rounded-md border border-status-danger-border bg-status-danger-bg px-[var(--space-sm)] text-caption font-bold text-status-danger-text disabled:opacity-45"
              >
                {rejecting ? "Rejecting…" : "Reject"}
              </button>
              <button
                type="button"
                onClick={() => void handlePrimaryAction()}
                disabled={isPostDisabled}
                className="h-9 rounded-md bg-accent px-[var(--space-md)] text-caption font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-45"
              >
                {posting ? "Posting…" : TIER_COPY[tier].action}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleSaveChanges()}
              disabled={isSaveDisabled}
              className="h-9 rounded-md bg-accent px-[var(--space-md)] text-caption font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-45"
            >
              {updatingExtractedData ? "Saving…" : "Save Changes"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)] sm:gap-[var(--space-lg)] sm:p-[var(--space-lg)] lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-md)]">
          {/* Hero */}
          <InvoiceHeroCard
            themeClasses={TIER_CLASSES[tier]}
            badgeVariant={tier === "success" ? "success" : tier === "warning" ? "warning" : "error"}
            badgeLabel={TIER_COPY[tier].status}
            confidenceScore={frozenConfidenceScore ?? 0}
            realmId={realmId}
            vendorName={invoice.vendor || "Select Vendor"}
            invoiceNumber={cleanValue(invoice.invoiceNumber) || null}
            invoiceDate={cleanValue(invoice.invoiceDate) ? toDateInputValue(invoice.invoiceDate) || invoice.invoiceDate : null}
            dueDate={cleanValue(invoice.dueDate) ? toDateInputValue(invoice.dueDate) || invoice.dueDate : null}
            totalAmountDisplay={totalAmountDisplay}
            reason={
              isPendingReview && reasonDisplay
                ? {
                    title: "Why this requires review",
                    message: reasonDisplay.message,
                    isTranslated: reasonDisplay.isTranslated,
                    raw: reasonDisplay.raw,
                    showTechnicalReason,
                    onToggleTechnicalReason: () => setShowTechnicalReason((v) => !v),
                  }
                : null
            }
            reasonExtra={
              vendorResolutionRequired &&
              (vendorIsResolved ? (
                <div className="mt-[var(--space-sm)] flex items-center justify-between gap-[var(--space-sm)] rounded-md border border-status-success-border bg-status-success-bg px-[var(--space-sm)] py-[var(--space-xs)]">
                  <span className="flex min-w-0 items-center gap-[var(--space-xs)] text-body-sm font-semibold text-status-success-text">
                    <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">Vendor resolved: {selectedVendor?.displayName || createdVendor?.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setVendorDialogOpen(true)}
                    className="shrink-0 text-body-sm font-bold text-accent"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setVendorDialogOpen(true)}
                  className="mt-[var(--space-sm)] flex w-full items-center justify-between border-t border-border pt-[var(--space-sm)] font-semibold text-accent"
                >
                  <span>+ Resolve Vendor</span>
                  <ChevronLeft size={18} strokeWidth={2} className="rotate-180" />
                </button>
              ))
            }
          />

          {/* Invoice Information */}
          <SectionCard
            title="Invoice Information"
            badge={
              invoiceInfoTopError && (
                <Badge variant="error" className="max-w-[260px] truncate">
                  {invoiceInfoTopError}
                </Badge>
              )
            }
          >
            <FieldRow id="field-invoiceNumber" label="Invoice Number" required>
              <InlineEditField
                ariaLabel="Invoice Number"
                value={invoice.invoiceNumber}
                onCommit={(v) => updateField("invoiceNumber", v)}
                placeholder="Enter Invoice Number"
                error={fieldErrors.invoiceNumber}
                className="text-right"
              />
            </FieldRow>
            <FieldRow label="Invoice Date">
              <div className="flex justify-end">
                <input
                  type="date"
                  value={toDateInputValue(invoice.invoiceDate)}
                  onChange={(e) => updateField("invoiceDate", e.target.value)}
                  className="rounded-md border border-border bg-surface px-[var(--space-sm)] py-[var(--space-xs)] text-right text-body-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              {!toDateInputValue(invoice.invoiceDate) && cleanValue(invoice.invoiceDate) && (
                <p className="mt-1 text-right text-caption text-content-muted">
                  Extracted: {invoice.invoiceDate} — pick a date above to fix the format
                </p>
              )}
            </FieldRow>
            <FieldRow label="Due Date">
              <div className="flex justify-end">
                <input
                  type="date"
                  value={toDateInputValue(invoice.dueDate)}
                  onChange={(e) => updateField("dueDate", e.target.value)}
                  className="rounded-md border border-border bg-surface px-[var(--space-sm)] py-[var(--space-xs)] text-right text-body-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>
              {!toDateInputValue(invoice.dueDate) && cleanValue(invoice.dueDate) && (
                <p className="mt-1 text-right text-caption text-content-muted">
                  Extracted: {invoice.dueDate} — pick a date above to fix the format
                </p>
              )}
            </FieldRow>
            <FieldRow id="field-currency" label="Currency" required>
              <div className="flex justify-end">
                <SelectDropdown
                  uiSize="sm"
                  error={fieldErrors.currency}
                  value={invoice.currency}
                  onChange={(e) => updateField("currency", e.target.value)}
                  className="w-32"
                >
                  <option value="" disabled>
                    Select Currency
                  </option>
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </SelectDropdown>
              </div>
              {fieldErrors.currency && (
                <p className="mt-[var(--space-xs)] text-right text-caption font-semibold text-status-danger-text">
                  {fieldErrors.currency}
                </p>
              )}
            </FieldRow>
            <FieldRow id="field-glAccountId" label="GL Code / Category (vendor default)" required>
              <div className="flex justify-end">
                <SelectDropdown
                  uiSize="sm"
                  error={fieldErrors.glAccountId}
                  value={invoice.glAccountId}
                  onChange={handleGlAccountChange}
                  title={resolvedGlAccountName || undefined}
                  className="w-56 max-w-full"
                >
                  <option value="" disabled>
                    {glAccountsLoading
                      ? "Loading accounts…"
                      : resolvedGlAccountName ||
                        (!glAccountsError && glAccounts.length === 0 ? "No GL accounts configured" : "Select GL Account")}
                  </option>
                  {glAccounts.map((account) => (
                    <option key={account._id} value={account.qbAccountId}>
                      {account.name}
                    </option>
                  ))}
                </SelectDropdown>
              </div>
              {fieldErrors.glAccountId && (
                <p className="mt-[var(--space-xs)] text-right text-caption font-semibold text-status-danger-text">
                  {fieldErrors.glAccountId}
                </p>
              )}
              {glAccountsMixedAcrossLines && (
                <p className="mt-[var(--space-xs)] text-right text-caption font-medium text-status-warning-text">
                  Multiple GL codes selected across line items — picking one here replaces all of them.
                </p>
              )}
              {glAccountsErrorDisplay && (
                <div className="mt-[var(--space-xs)] text-right">
                  <p className="text-caption font-semibold text-status-danger-text">
                    Couldn&apos;t load GL accounts — {glAccountsErrorDisplay.message}
                  </p>
                  {glAccountsErrorDisplay.isTranslated && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowGlAccountsErrorDetails((v) => !v)}
                        className="mt-1 text-caption font-semibold text-content-secondary underline"
                      >
                        {showGlAccountsErrorDetails ? "Hide technical details" : "Show technical details"}
                      </button>
                      {showGlAccountsErrorDetails && (
                        <p className="mt-1 break-words text-caption text-content-muted">{glAccountsErrorDisplay.raw}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </FieldRow>
            <FieldRow label="Tax Code (vendor default)">
              <div className="flex justify-end">
                <SelectDropdown
                  uiSize="sm"
                  value={invoice.taxCodeId}
                  onChange={handleTaxCodeChange}
                  title={resolvedTaxCodeName || undefined}
                  className="w-56 max-w-full"
                >
                  <option value="">
                    {taxCodesLoading
                      ? "Loading tax codes…"
                      : resolvedTaxCodeName ||
                        (!taxCodesError && taxCodes.length === 0 ? "No tax codes configured" : "Select Tax Code (optional)")}
                  </option>
                  {taxCodes.map((code) => (
                    <option key={getTaxCodeId(code)} value={getTaxCodeId(code)}>
                      {getTaxCodeLabel(code)}
                    </option>
                  ))}
                </SelectDropdown>
              </div>
              {taxCodesMixedAcrossLines && (
                <p className="mt-[var(--space-xs)] text-right text-caption font-medium text-status-warning-text">
                  Multiple tax codes selected across line items — picking one here replaces all of them.
                </p>
              )}
              {taxCodesErrorDisplay && (
                <div className="mt-[var(--space-xs)] text-right">
                  <p className="text-caption font-semibold text-status-danger-text">
                    Couldn&apos;t load tax codes — {taxCodesErrorDisplay.message}
                  </p>
                  {taxCodesErrorDisplay.isTranslated && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowTaxCodesErrorDetails((v) => !v)}
                        className="mt-1 text-caption font-semibold text-content-secondary underline"
                      >
                        {showTaxCodesErrorDetails ? "Hide technical details" : "Show technical details"}
                      </button>
                      {showTaxCodesErrorDetails && (
                        <p className="mt-1 break-words text-caption text-content-muted">{taxCodesErrorDisplay.raw}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </FieldRow>
            {/* <FieldRow label="Uploaded By">
              <span className="block w-full text-right text-body-sm font-bold text-content-primary">
                {getUserDisplayName(invoiceObject?.uploadedBy) || "—"}
              </span>
            </FieldRow> */}
            <div className="border-t border-border px-[var(--space-md)] py-[var(--space-sm)] text-caption text-content-muted">
              {lastModifiedByName && <>Last modified by {lastModifiedByName}</>}
              {lastModifiedByName && realmId && " · "}
              {realmId && <>Linked to QBO Realm: {realmId}</>}
              {!lastModifiedByName && !realmId && "—"}
            </div>
          </SectionCard>

          {/* Financial Summary */}
          <SectionCard
            title="Financial Summary"
            badge={!isBalanced && <Badge variant="warning">Mismatch</Badge>}
            defaultOpen={false}
            forceOpen={Boolean(fieldErrors.amountBeforeTax || fieldErrors.taxAmount || fieldErrors.totalAfterTax)}
          >
            <FieldRow id="field-amountBeforeTax" label="Before Tax" required={!hasLineItemsForTotal}>
              {hasLineItemsForTotal ? (
                // Not independently editable once line items exist — always
                // their sum. Add/edit/remove a line item to change this.
                <ReadOnlyAmount>{formatDetailAmount(invoice.amountBeforeTax || null, currencyForAmount)}</ReadOnlyAmount>
              ) : (
                <InlineEditField
                  ariaLabel="Amount Before Tax"
                  value={invoice.amountBeforeTax}
                  onCommit={(v) => updateField("amountBeforeTax", v)}
                  placeholder="Enter Amount Before Tax"
                  inputMode="decimal"
                  error={fieldErrors.amountBeforeTax}
                  formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                  className="text-right"
                />
              )}
            </FieldRow>
            {/* Read-only here — these amounts are edited in their own
                dedicated sections below (Extra Charges / Discounts). Shown
                only when non-zero, so an invoice with neither doesn't carry
                two empty rows for no reason. */}
            {extraChargesSum > 0 && (
              <FieldRow label="Extra Charges">
                <ReadOnlyAmount>+ {formatDetailAmount(extraChargesSum, currencyForAmount)}</ReadOnlyAmount>
              </FieldRow>
            )}
            {discountsSum > 0 && (
              <FieldRow label="Discounts">
                <ReadOnlyAmount className="text-status-success-text">− {formatDetailAmount(discountsSum, currencyForAmount)}</ReadOnlyAmount>
              </FieldRow>
            )}
            {/* Not independently editable — each line item × its tax code's
                QuickBooks rate (vendor default unless the line overrides it).
                Extra charges and discounts are never taxed. With more than one
                rate charged, each gets its own row, then the total. */}
            {taxBreakdown.length > 1 &&
              taxBreakdown.map((entry) => (
                <FieldRow key={entry.rateId} label={taxRateRowLabel(entry)}>
                  <ReadOnlyAmount>{formatDetailAmount(entry.amount, currencyForAmount)}</ReadOnlyAmount>
                </FieldRow>
              ))}
            <FieldRow id="field-taxAmount" label={taxTotalRowLabel}>
              <ReadOnlyAmount>{formatDetailAmount(computedTax, currencyForAmount)}</ReadOnlyAmount>
              {hasLineItemsForTotal && lineItemsTax.usedCodeIds.length === 0 && (
                <p className="mt-[var(--space-xs)] text-right text-caption text-content-secondary">
                  No tax code on any line item.
                </p>
              )}
              {lineItemsTax.hasUnknownRate && (
                <p className="mt-[var(--space-xs)] text-right text-caption font-medium text-status-warning-text">
                  A tax code on these line items has no rate from QuickBooks yet — sync tax codes, or its tax is counted
                  as 0.
                </p>
              )}
            </FieldRow>
            <FieldRow id="field-totalAfterTax" label="Total" highlight>
              {/* Not independently editable — always line items (or 0) plus
                  tax plus extra charges minus discounts. The only way to
                  change it is to change one of those. */}
              <ReadOnlyAmount className="font-black text-content-primary">
                {formatDetailAmount(invoice.totalAfterTax || null, currencyForAmount)}
              </ReadOnlyAmount>
              <p className="mt-[var(--space-xs)] text-right text-tiny text-content-muted">
                {hasLineItemsForTotal
                  ? "Computed from line items + tax + extra charges − discounts"
                  : "No line items yet — add at least one to compute a total"}
              </p>
            </FieldRow>
            {totalMismatch && (
              <div className="mx-[var(--space-md)] mb-[var(--space-md)] mt-[var(--space-sm)] flex items-start gap-[var(--space-xs)] rounded-md border border-status-warning-border bg-status-warning-bg p-[var(--space-sm)]">
                <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-status-warning-text" />
                <p className="text-caption font-medium text-status-warning-text">
                  Posting <strong className="text-content-primary">{formatDetailAmount(computedTotal, currencyForAmount)}</strong>, but the scan showed{" "}
                  <strong className="text-content-primary">{formatDetailAmount(originalExtractedTotal, currencyForAmount)}</strong>. Please double-check before posting.
                </p>
              </div>
            )}
          </SectionCard>

          {/* Line Items */}
          <SectionCard
            title={`Line Items (${lineItems.length})`}
            hint="Click a value or its pencil to inline edit."
          >
            <div className="flex flex-col gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)]">
              {lineItems.map((item, index) => (
                <div key={index} className="rounded-md border border-border p-[var(--space-sm)]">
                  <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-bg text-caption font-bold text-accent-text-on-bg">
                      {index + 1}
                    </span>
                    <InlineEditField
                      ariaLabel={`Line item ${index + 1} description`}
                      value={item.description}
                      onCommit={(v) => updateLineItem(index, "description", v)}
                      onEnter={() => unitPriceFieldRefs.current[index]?.startEdit()}
                      placeholder="Item description"
                      align="left"
                      className="min-w-0 flex-1 font-semibold"
                    />
                    <SelectDropdown
                      uiSize="sm"
                      value={item.glAccountId || ""}
                      onChange={(e) => updateLineItemGlAccount(index, e.target.value)}
                      // Fixed width, same as the tax dropdown — a long name
                      // ellipsizes (full name on hover and in the open list).
                      title={glAccounts.find((a) => a.qbAccountId === item.glAccountId)?.name || "Select GL"}
                      className="w-40 shrink-0 text-tiny"
                    >
                      {/* Placeholder only — a line always carries an explicit GL
                          (filled from the vendor on load, or picked here). */}
                      <option value="" disabled>
                        Select GL
                      </option>
                      {glAccounts.map((account) => (
                        <option key={account._id} value={account.qbAccountId}>
                          {account.name}
                        </option>
                      ))}
                    </SelectDropdown>
                    {/* Editable regardless of postedStatus, same as the GL
                        dropdown above — editing an already-posted invoice
                        re-syncs its QuickBooks bill via updateBillInQB, which
                        reads this same per-line taxCodeId. Empty only when
                        neither the line nor the vendor has a code (computed
                        as 0%) — shows the "Select Tax" placeholder. */}
                    <SelectDropdown
                      uiSize="sm"
                      value={item.taxCodeId || ""}
                      onChange={(e) => updateLineItemTaxCode(index, e.target.value)}
                      title={(() => {
                        const code = taxCodeById.get(item.taxCodeId || cleanValue(invoice.taxCodeId));
                        return code ? getTaxCodeLabel(code) : "None (0%)";
                      })()}
                      className="w-40 shrink-0 text-tiny"
                    >
                      {/* Placeholder only — for no tax, pick a 0% code
                          (Exempt / Zero-rated / Out of Scope). */}
                      <option value="" disabled>
                        {taxCodesLoading ? "Loading…" : "Select Tax"}
                      </option>
                      {taxCodes.map((code) => (
                        <option key={getTaxCodeId(code)} value={getTaxCodeId(code)}>
                          {getTaxCodeLabel(code)}
                        </option>
                      ))}
                    </SelectDropdown>
                    <div className="flex shrink-0 items-center gap-[var(--space-xs)]">
                      <button
                        type="button"
                        onClick={() => duplicateLineItem(index)}
                        aria-label="Duplicate line item"
                        className="text-content-muted hover:text-accent"
                      >
                        <Copy size={14} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        aria-label="Remove line item"
                        className="text-content-muted hover:text-status-danger-text"
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-[var(--space-xs)] grid grid-cols-3 gap-[var(--space-sm)] pl-[calc(24px+var(--space-sm))]">
                    <label className="flex flex-col gap-[2px]">
                      <span className="text-tiny text-content-muted">Qty</span>
                      <InlineEditField
                        ariaLabel={`Line item ${index + 1} quantity`}
                        value={String(item.quantity)}
                        onCommit={(v) => updateLineItem(index, "quantity", v)}
                        inputMode="decimal"
                        className="rounded-md bg-surface-alt"
                      />
                    </label>
                    <label className="flex flex-col gap-[2px]">
                      <span className="text-tiny text-content-muted">Unit price</span>
                      <InlineEditField
                        ref={(handle) => {
                          unitPriceFieldRefs.current[index] = handle;
                        }}
                        ariaLabel={`Line item ${index + 1} unit price`}
                        value={String(item.unitPrice)}
                        onCommit={(v) => updateLineItem(index, "unitPrice", v)}
                        inputMode="decimal"
                        formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                        className="rounded-md bg-surface-alt"
                      />
                    </label>
                    <label className="flex flex-col gap-[2px]">
                      <span className="text-tiny text-content-muted">Amount</span>
                      {/* Not independently editable — always quantity ×
                          unit price. Change one of those to change this. */}
                      <span className="rounded-md bg-surface-alt px-[var(--space-xs)] py-1 text-right font-bold text-content-primary">
                        {formatDetailAmount(item.amount, currencyForAmount)}
                      </span>
                    </label>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addLineItem}
                className="flex items-center justify-center gap-[var(--space-xs)] rounded-md border border-dashed border-border-strong py-[var(--space-sm)] text-body-sm font-semibold text-accent hover:bg-accent-bg/40"
              >
                <Plus size={14} strokeWidth={2.5} />
                Add line item
              </button>
            </div>
          </SectionCard>

          {/* Extra Charges */}
          <SectionCard
            title={`Extra Charges (${extraCharges.length})`}
            defaultOpen={extraCharges.length > 0}
            hint="Click a value or its pencil to inline edit."
          >
            <div className="flex flex-col gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)]">
              {extraCharges.map((charge, index) => (
                <div key={index} className="rounded-md border border-border p-[var(--space-sm)]">
                  <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-bg text-caption font-bold text-accent-text-on-bg">
                      {index + 1}
                    </span>
                    <InlineEditField
                      ariaLabel={`Extra charge ${index + 1} description`}
                      value={charge.description}
                      onCommit={(v) => updateExtraChargeDescription(index, v)}
                      onEnter={() => extraChargeAmountFieldRefs.current[index]?.startEdit()}
                      placeholder="Charge description"
                      align="left"
                      className="min-w-0 flex-1 font-semibold"
                    />
                    {/* Inline, right before copy/delete — same single row as the description. */}
                    <InlineEditField
                      ref={(handle) => {
                        extraChargeAmountFieldRefs.current[index] = handle;
                      }}
                      ariaLabel={`Extra charge ${index + 1} amount`}
                      value={String(charge.amount)}
                      onCommit={(v) => updateExtraChargeAmount(index, v)}
                      inputMode="decimal"
                      formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                      className={`w-32 shrink-0 rounded-md bg-surface-alt font-bold ${TIER_CLASSES[tier].text}`}
                    />
                    <div className="flex shrink-0 items-center gap-[var(--space-xs)]">
                      <button
                        type="button"
                        onClick={() => duplicateExtraCharge(index)}
                        aria-label="Duplicate extra charge"
                        className="text-content-muted hover:text-accent"
                      >
                        <Copy size={14} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeExtraCharge(index)}
                        aria-label="Remove extra charge"
                        className="text-content-muted hover:text-status-danger-text"
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addExtraCharge}
                className="flex items-center justify-center gap-[var(--space-xs)] rounded-md border border-dashed border-border-strong py-[var(--space-sm)] text-body-sm font-semibold text-accent hover:bg-accent-bg/40"
              >
                <Plus size={14} strokeWidth={2.5} />
                Add extra charge
              </button>
            </div>
          </SectionCard>

          {/* Discounts */}
          <SectionCard
            title={`Discounts (${discounts.length})`}
            defaultOpen={discounts.length > 0}
            hint="Click a value or its pencil to inline edit."
          >
            <div className="flex flex-col gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)]">
              {discounts.map((discount, index) => (
                <div key={index} className="rounded-md border border-border p-[var(--space-sm)]">
                  <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-bg text-caption font-bold text-accent-text-on-bg">
                      {index + 1}
                    </span>
                    <InlineEditField
                      ariaLabel={`Discount ${index + 1} description`}
                      value={discount.description}
                      onCommit={(v) => updateDiscountDescription(index, v)}
                      onEnter={() => discountAmountFieldRefs.current[index]?.startEdit()}
                      placeholder="Discount description"
                      align="left"
                      className="min-w-0 flex-1 font-semibold"
                    />
                    <InlineEditField
                      ref={(handle) => {
                        discountAmountFieldRefs.current[index] = handle;
                      }}
                      ariaLabel={`Discount ${index + 1} amount`}
                      value={String(discount.amount)}
                      onCommit={(v) => updateDiscountAmount(index, v)}
                      inputMode="decimal"
                      formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                      className="w-32 shrink-0 rounded-md bg-surface-alt font-bold text-status-success-text"
                    />
                    <div className="flex shrink-0 items-center gap-[var(--space-xs)]">
                      <button
                        type="button"
                        onClick={() => duplicateDiscount(index)}
                        aria-label="Duplicate discount"
                        className="text-content-muted hover:text-accent"
                      >
                        <Copy size={14} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDiscount(index)}
                        aria-label="Remove discount"
                        className="text-content-muted hover:text-status-danger-text"
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addDiscount}
                className="flex items-center justify-center gap-[var(--space-xs)] rounded-md border border-dashed border-border-strong py-[var(--space-sm)] text-body-sm font-semibold text-accent hover:bg-accent-bg/40"
              >
                <Plus size={14} strokeWidth={2.5} />
                Add discount
              </button>
            </div>
          </SectionCard>
        </div>

        {/* Column-width drag handle — widening/narrowing the panel here
            resizes Scanned Copy, Vendor Details, Item Description Notes and
            Status History together, since they all share this one column. */}
        <div
          onPointerDown={handleAsideResizeStart}
          onPointerMove={handleAsideResizeMove}
          onPointerUp={handleAsideResizeEnd}
          onPointerCancel={handleAsideResizeEnd}
          onDoubleClick={() => setAsideWidth(ASIDE_DEFAULT_WIDTH)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          title="Drag to resize · double-click to reset"
          className="hidden shrink-0 cursor-col-resize touch-none items-center justify-center self-stretch rounded-md bg-surface-alt hover:bg-border lg:flex lg:w-2"
        >
          <span className="h-10 w-1 rounded-full bg-border-strong" />
        </div>

        <aside
          style={
            {
              "--v2-header-h": `${headerHeight}px`,
              "--v2-aside-w": `${asideWidth}px`,
            } as CSSProperties
          }
          // No max-h/overflow-y-auto here on purpose — that clipped this
          // column's own internal scrollbar right at the viewport edge, so a
          // field sitting exactly on that boundary (e.g. Item Description
          // Notes, once Vendor Details/Status History were also open) was
          // visibly rendered but NOT clickable, since its position was past
          // the clipped hit-test area. Sticky alone degrades gracefully —
          // once this column's content is taller than the viewport, it just
          // scrolls normally with the page instead of fighting an inner
          // scrollbar for space.
          className="flex w-full min-w-0 flex-col gap-[var(--space-md)] lg:sticky lg:top-[var(--v2-header-h)] lg:w-[var(--v2-aside-w)] lg:shrink-0"
        >
          {/* Scanned copy */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-[var(--space-md)] gap-y-[var(--space-xs)] border-b border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
              <span className="text-caption font-bold uppercase tracking-wide text-content-secondary">Scanned Copy</span>
              <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                {!isPdf && previewUrl && (
                  <div className="flex items-center gap-[var(--space-xs)]">
                    <button
                      type="button"
                      onClick={() => setScanZoom((z) => Math.max(SCAN_MIN_ZOOM, z - SCAN_ZOOM_STEP))}
                      disabled={scanZoom <= SCAN_MIN_ZOOM}
                      aria-label="Zoom out"
                      className="text-content-secondary disabled:opacity-40"
                    >
                      <ZoomOut size={16} strokeWidth={2} />
                    </button>
                    <span className="w-9 text-center text-caption font-semibold text-content-secondary">
                      {Math.round(scanZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setScanZoom((z) => Math.min(SCAN_MAX_ZOOM, z + SCAN_ZOOM_STEP))}
                      disabled={scanZoom >= SCAN_MAX_ZOOM}
                      aria-label="Zoom in"
                      className="text-content-secondary disabled:opacity-40"
                    >
                      <ZoomIn size={16} strokeWidth={2} />
                    </button>
                  </div>
                )}
                {previewUrl && (
                  <a href={previewUrl} download target="_blank" rel="noopener noreferrer" aria-label="Download scanned copy" className="text-content-secondary hover:text-accent">
                    <Download size={16} strokeWidth={2} />
                  </a>
                )}
                {previewUrl && (
                  <button type="button" onClick={handlePrint} aria-label="Print scanned copy" className="text-content-secondary hover:text-accent">
                    <Printer size={16} strokeWidth={2} />
                  </button>
                )}
                {driveFileUrl && (
                  <a href={driveFileUrl} target="_blank" rel="noopener noreferrer" aria-label="View in Google Drive">
                    <BrandIcon name="google-drive" size={16} />
                  </a>
                )}
                {previewHref && (
                  <Link href={previewHref} className="text-caption font-bold text-accent">
                    Open
                  </Link>
                )}
                {/* Always in the header (not the resizable box below), so
                    they stay reachable even after dragging/maximizing the
                    panel pushes the drag handle itself below the fold of the
                    aside's own scroll area. */}
                <button
                  type="button"
                  onClick={handleToggleScanPanelMaximize}
                  aria-label={isScanPanelMaximized ? "Restore scanned copy size" : "Maximize scanned copy"}
                  title={isScanPanelMaximized ? "Restore size" : "Maximize"}
                  className="text-content-secondary hover:text-accent"
                >
                  {isScanPanelMaximized ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    preMaximizeHeightRef.current = SCAN_PANEL_DEFAULT_HEIGHT;
                    setScanPanelHeight(SCAN_PANEL_DEFAULT_HEIGHT);
                  }}
                  aria-label="Reset scanned copy size"
                  title="Reset size"
                  className="text-content-secondary hover:text-accent"
                >
                  <RotateCcw size={14} strokeWidth={2} />
                </button>
              </div>
            </div>

            <div
              style={{ height: scanPanelHeight }}
              className={`relative bg-page ${scanZoom > 1 ? "overflow-auto" : "overflow-hidden"}`}
            >
              {scanLoading && previewUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Spinner size="md" />
                </div>
              )}
              {previewUrl ? (
                isPdf ? (
                  <iframe src={previewUrl} title="Invoice scan" className="h-full w-full border-none" onLoad={() => setScanLoading(false)} />
                ) : scanZoom > 1 ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote S3 URL, not a static local asset next/image can optimize.
                  <img
                    src={previewUrl}
                    alt="Invoice scan"
                    style={{ width: `${scanZoom * 100}%`, maxWidth: "none" }}
                    onLoad={() => setScanLoading(false)}
                    onError={() => setScanLoading(false)}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote S3 URL, not a static local asset next/image can optimize.
                  <img
                    src={previewUrl}
                    alt="Invoice scan"
                    className="h-full w-full object-contain"
                    onLoad={() => setScanLoading(false)}
                    onError={() => setScanLoading(false)}
                  />
                )
              ) : (
                <div className="flex h-full items-center justify-center px-[var(--space-md)] text-center">
                  <p className="text-body-sm text-content-secondary">No scanned copy available for this invoice.</p>
                </div>
              )}
            </div>

            {/* Drag to minimize/maximize the scanned copy, clamped between
                SCAN_PANEL_MIN_HEIGHT and SCAN_PANEL_MAX_HEIGHT. */}
            <div
              onPointerDown={handleScanResizeStart}
              onPointerMove={handleScanResizeMove}
              onPointerUp={handleScanResizeEnd}
              onPointerCancel={handleScanResizeEnd}
              onDoubleClick={() => {
                preMaximizeHeightRef.current = SCAN_PANEL_DEFAULT_HEIGHT;
                setScanPanelHeight(SCAN_PANEL_DEFAULT_HEIGHT);
              }}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize scanned copy"
              title="Drag to resize · double-click to reset"
              className="flex h-3 shrink-0 cursor-ns-resize touch-none items-center justify-center border-t border-border bg-page hover:bg-surface-alt"
            >
              <span className="h-1 w-10 rounded-full bg-border-strong" />
            </div>
          </div>


          {/* Vendor Details */}
          <SectionCard
            title="Vendor Details"
            defaultOpen={false}
            forceOpen={Boolean(vendorInfoTopError)}
            badge={
              vendorInfoTopError && (
                <Badge variant="error" className="max-w-[260px] truncate">
                  {vendorInfoTopError}
                </Badge>
              )
            }
          >
            <FieldRow id="field-vendor" label="Vendor Entity" required>
              {isPendingReview ? (
                // Falls back to the backend's own auto-match when the user
                // never went through the manual "Change vendor" flow — mirrors
                // the fallback chain submitToQuickBooks uses when posting.
                //
                // linkedVendorId can be a dangling reference (the vendor
                // record it points to was deleted and recreated under a new
                // _id, e.g. after a disconnect/resync) — a raw <select>
                // whose value matches no <option> falls back to displaying
                // the FIRST option, which misleadingly looked "selected" when
                // a same-named vendor happened to be first in the list. Only
                // ever pass a value that's actually in `vendors`; otherwise
                // show the real "nothing selected" placeholder.
                (() => {
                  const linkedVendorId = selectedVendor?._id || invoiceObject?.vendor?.vendorDbId || "";
                  const linkedVendorExists = vendors.some((v) => v._id === linkedVendorId);
                  const vendorIsStale = Boolean(linkedVendorId) && !linkedVendorExists && !vendorsLoading;
                  return (
                    <>
                      <div className="flex justify-end">
                        <SelectDropdown
                          uiSize="sm"
                          error={fieldErrors.vendor}
                          value={linkedVendorExists ? linkedVendorId : ""}
                          onChange={handleVendorChange}
                          className="max-w-sm"
                        >
                          <option value="" disabled>
                            Select Vendor
                          </option>
                          {vendors.map((vendor) => (
                            <option key={vendor._id} value={vendor._id}>
                              {vendor.displayName}
                            </option>
                          ))}
                        </SelectDropdown>
                      </div>
                      {vendorIsStale && (
                        <p className="mt-[var(--space-xs)] text-right text-caption font-medium text-status-warning-text">
                          Linked vendor record no longer exists (it may have been deleted and re-synced) — please
                          re-select the vendor above.
                        </p>
                      )}
                    </>
                  );
                })()
              ) : (
                // Not editable outside pending review — the vendor is already
                // linked to a QB vendor record with no safe way to change it here.
                <span className="block w-full text-right text-body-sm font-bold text-content-primary">{invoice.vendor || "—"}</span>
              )}
              {fieldErrors.vendor && (
                <p className="mt-[var(--space-xs)] text-right text-caption font-semibold text-status-danger-text">
                  {fieldErrors.vendor}
                </p>
              )}
            </FieldRow>
            <FieldRow label="Vendor Address" stacked>
              <InlineEditField
                ariaLabel="Vendor Address"
                value={invoice.vendorAddress}
                onCommit={(v) => updateField("vendorAddress", v)}
                multiline
                align="left"
                placeholder="Enter Vendor Address"
              />
            </FieldRow>
            <FieldRow label="Bank & Wire Details" stacked>
              <InlineEditField
                ariaLabel="Vendor Bank Details"
                value={invoice.vendorBankDetails}
                onCommit={(v) => updateField("vendorBankDetails", v)}
                multiline
                align="left"
                placeholder="Enter Vendor Bank Details"
              />
            </FieldRow>
          </SectionCard>

          {/* Item Description Notes */}
          <SectionCard
            title="Item Description Notes"
            badge={<StickyNote size={14} strokeWidth={2} className="text-content-muted" />}
            defaultOpen={false}
          >
            <div className="px-[var(--space-md)] py-[var(--space-md)]">
              <InlineEditField
                ariaLabel="Item Description Notes"
                value={invoice.itemDescriptionsText}
                onCommit={(v) => updateField("itemDescriptionsText", v)}
                multiline
                align="left"
                placeholder="Enter item description notes"
              />
            </div>
          </SectionCard>

                    {/* Status History */}
          {statusHistory.length > 0 && (
            <SectionCard title="Status History" defaultOpen={false}>
              <div className="flex flex-col gap-[var(--space-md)] px-[var(--space-md)] py-[var(--space-md)]">
                {statusHistory.map((entry, index) => {
                  const isLast = index === statusHistory.length - 1;
                  const entryReason = translateInvoiceReason(entry.reason);
                  const changedByName = getUserDisplayName(entry.changedBy);
                  return (
                    <div key={index} className="flex gap-[var(--space-sm)]">
                      <span
                        className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                          isLast ? "border-accent bg-accent" : "border-border-strong bg-border"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-content-primary">
                          {entry.postedStatus ? entry.postedStatus.charAt(0).toUpperCase() + entry.postedStatus.slice(1) : "—"}
                        </p>
                        {(changedByName || entry.changedAt) && (
                          <p className="text-caption text-content-secondary">
                            {changedByName && `By ${changedByName}`}
                            {changedByName && entry.changedAt && "  ·  "}
                            {entry.changedAt && formatDetailDateTime(entry.changedAt)}
                          </p>
                        )}
                        {entryReason && <p className="text-caption font-semibold text-accent">{entryReason.message}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

        </aside>
      </div>

      <VendorResolutionDialogV2
        invoiceId={invoiceId}
        open={vendorDialogOpen}
        onClose={() => setVendorDialogOpen(false)}
      />
    </div>
  );
}
