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
import { VendorResolutionDialogV2 } from "@/components/v2/invoices/VendorResolutionDialogV2";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getInvoiceDetails,
  getInvoices,
  postInvoiceToQuickBooks,
  rejectInvoice,
  updateInvoiceExtractedData,
} from "@/store/invoice/invoiceApi";
import type { ExtraCharge, LineItem } from "@/store/invoice/invoiceSlice";
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
import { taxCodeId as getTaxCodeId, taxCodeName as getTaxCodeName } from "@/lib/quickbooks/taxCode";

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

// Same radius-with-pathLength(100) technique OutcomeMixCardV2 uses for its
// donut — lets stroke-dasharray/offset be plain percentages regardless of
// the actual circle radius.
const RING_RADIUS = 15.9155;

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
}): NormalizedInvoiceData {
  return {
    vendor: safeValue(data.vendorName),
    vendorAddress: safeValue(data.vendorAddress),
    vendorBankDetails: safeValue(data.bankingDetails),
    invoiceNumber: safeValue(data.invoiceNumber),
    invoiceDate: safeValue(data.invoiceDate),
    dueDate: safeValue(data.dueDate),
    amountBeforeTax: safeValue(data.amountBeforeTax),
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
  if (!cleanValue(data.taxAmount)) errors.taxAmount = "Tax amount is required";
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

function ConfidenceRing({ percent, tier }: { percent: number; tier: ConfidenceTier }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        <circle cx="18" cy="18" r={RING_RADIUS} fill="none" strokeWidth={3} className="stroke-border" />
        <circle
          cx="18"
          cy="18"
          r={RING_RADIUS}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${clamped} ${100 - clamped}`}
          pathLength={100}
          stroke="currentColor"
          className={TIER_CLASSES[tier].text}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-caption font-extrabold ${TIER_CLASSES[tier].text}`}>{Math.round(clamped)}%</span>
        <span className="text-[9px] font-semibold text-content-secondary">conf.</span>
      </div>
    </div>
  );
}

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

  const invoiceObject = useAppSelector((state) => state.invoice.selectedInvoice);
  const rejecting = useAppSelector((state) => state.invoice.rejecting);
  const posting = useAppSelector((state) => state.invoice.posting);
  const updatingExtractedData = useAppSelector((state) => state.invoice.updatingExtractedData);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const glAccountsLoading = useAppSelector((state) => state.quickBooks.accountsLoading);
  const glAccountsError = useAppSelector((state) => state.quickBooks.accountsError);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const taxCodesLoading = useAppSelector((state) => state.quickBooks.taxCodesLoading);
  const taxCodesError = useAppSelector((state) => state.quickBooks.taxCodesError);
  const realmId = useAppSelector((state) => state.quickBooks.realmId);
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
    // can compare against every invoice this tab knows about.
    dispatch(getInvoices());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  useEffect(() => {
    if (!accessToken) return;
    // Sequential, not parallel — see InvoiceReviewContent.tsx (v1) for why:
    // near-simultaneous requests sharing one QuickBooks connection can race a
    // backend token refresh.
    (async () => {
      await dispatch(fetchQuickBooksVendors({ accessToken }));
      await dispatch(fetchQuickBooksAccounts({ accessToken }));
      await dispatch(fetchQuickBooksTaxCodes({ accessToken }));
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
  const [frozenConfidenceScore] = useState(confidenceScore);
  const tier = useMemo(() => getConfidenceTier(frozenConfidenceScore), [frozenConfidenceScore]);
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
  const [lineItems, setLineItems] = useState<LineItem[]>(() => rawData.lineItems || []);
  const [extraCharges, setExtraCharges] = useState<ExtraCharge[]>(() => rawData.extraCharges || []);
  const [showConfidenceInfo, setShowConfidenceInfo] = useState(false);

  // Full reset only when the underlying invoice itself changes — see
  // InvoiceReviewContent.tsx (v1) for why this deliberately does NOT re-run
  // when selectedVendor/createdVendor change on their own.
  useEffect(() => {
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
    setLineItems(invoiceObject?.extractedData?.lineItems || []);
    setExtraCharges(invoiceObject?.extractedData?.extraCharges || []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVendor, createdVendor]);

  const updateField = (key: keyof NormalizedInvoiceData, value: string) => {
    setInvoice((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const updateLineItem = (index: number, key: keyof LineItem, value: string) => {
    setLineItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [key]: key === "description" ? value : Number(value) || 0 } : item,
      ),
    );
  };

  const updateLineItemGlAccount = (index: number, glAccountId: string) => {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, glAccountId: glAccountId || undefined } : item)));
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const duplicateLineItem = (index: number) => {
    setLineItems((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, { ...prev[index] });
      return next;
    });
  };

  const removeLineItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Extra charges started as extraction/reconciliation output only, but the
  // LLM doesn't always find everything, so this carries the same full
  // add/edit/remove affordance as line items. Total Amount is what actually
  // posts to QuickBooks, so every mutation here recomputes it directly.
  const recalculateTotalFromExtraCharges = (nextExtraCharges: ExtraCharge[]) => {
    const extraSum = nextExtraCharges.reduce((s, c) => s + c.amount, 0);
    const recalculatedTotal = parseFloat(
      ((Number(invoice.amountBeforeTax) || 0) + (Number(invoice.taxAmount) || 0) + extraSum).toFixed(2),
    );
    setInvoice((prev) => ({ ...prev, totalAfterTax: String(recalculatedTotal) }));
    setFieldErrors((prev) => {
      if (!prev.totalAfterTax) return prev;
      const updated = { ...prev };
      delete updated.totalAfterTax;
      return updated;
    });
  };

  const updateExtraChargeDescription = (index: number, value: string) => {
    setExtraCharges((prev) => prev.map((c, i) => (i === index ? { ...c, description: value } : c)));
  };

  const updateExtraChargeTaxCode = (index: number, taxCodeIdValue: string) => {
    setExtraCharges((prev) => prev.map((c, i) => (i === index ? { ...c, taxCodeId: taxCodeIdValue || null } : c)));
  };

  const updateExtraChargeAmount = (index: number, value: string) => {
    const nextExtraCharges = extraCharges.map((c, i) => (i === index ? { ...c, amount: Number(value) || 0 } : c));
    setExtraCharges(nextExtraCharges);
    recalculateTotalFromExtraCharges(nextExtraCharges);
  };

  const addExtraCharge = () => {
    const nextExtraCharges = [...extraCharges, { description: "", amount: 0, taxCodeId: null }];
    setExtraCharges(nextExtraCharges);
    recalculateTotalFromExtraCharges(nextExtraCharges);
  };

  const removeExtraCharge = (index: number) => {
    const nextExtraCharges = extraCharges.filter((_, i) => i !== index);
    setExtraCharges(nextExtraCharges);
    recalculateTotalFromExtraCharges(nextExtraCharges);
  };

  const resolvedGlAccountName = useMemo(
    () => glAccounts.find((acc) => acc.qbAccountId === invoice.glAccountId)?.name || "",
    [glAccounts, invoice.glAccountId],
  );

  const resolvedTaxCodeName = useMemo(() => {
    const match = taxCodes.find((code) => getTaxCodeId(code) === invoice.taxCodeId);
    return match ? getTaxCodeName(match) : "";
  }, [taxCodes, invoice.taxCodeId]);

  // Real, computed reconciliation check — not decorative: before-tax + tax +
  // extra charges should equal the total actually posted to QuickBooks.
  const beforeTaxNumber = Number(invoice.amountBeforeTax) || 0;
  const taxNumber = Number(invoice.taxAmount) || 0;
  const extraChargesSum = extraCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const totalNumber = Number(invoice.totalAfterTax) || 0;
  const reconciledTotal = beforeTaxNumber + taxNumber + extraChargesSum;
  const reconciliationDiff = Math.abs(reconciledTotal - totalNumber);
  const isBalanced = reconciliationDiff < 0.01;
  const verifiedPercent = totalNumber > 0 ? Math.max(0, 100 - Math.min(100, (reconciliationDiff / totalNumber) * 100)) : 100;
  const taxRatePercent = beforeTaxNumber > 0 ? Math.round((taxNumber / beforeTaxNumber) * 100) : null;

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

  const handleGlAccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const account = glAccounts.find((acc) => acc.qbAccountId === event.target.value);
    if (!account) return;
    setInvoice((prev) => ({ ...prev, glAccountId: account.qbAccountId }));
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
    if (!cleanValue(invoice.taxAmount)) errors.taxAmount = "Tax amount is required";
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
    taxAmount: Number(invoice.taxAmount) || 0,
    totalAmount: Number(invoice.totalAfterTax) || 0,
    lineItems,
    extraCharges,
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
      router.push("/v2/invoices?type=pending");
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
      router.push("/v2/invoices?type=pending");
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
      router.push(`/v2/invoices/${invoiceId}`);
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to update invoice.", "error");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
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
          <div className={`relative overflow-hidden rounded-2xl border p-[var(--space-lg)] ${TIER_CLASSES[tier].bg} ${TIER_CLASSES[tier].border}`}>
            <button
              type="button"
              onClick={() => setShowConfidenceInfo(true)}
              aria-label="How is this score calculated?"
              className={`absolute right-[var(--space-md)] top-[var(--space-md)] flex h-8 w-8 items-center justify-center rounded-full bg-surface font-extrabold shadow-sm ${TIER_CLASSES[tier].text}`}
            >
              ?
            </button>

            <div className="mb-[var(--space-md)] flex flex-wrap items-center gap-[var(--space-xs)] pr-10">
              <Badge variant={tier === "success" ? "success" : tier === "warning" ? "warning" : "error"}>
                {TIER_COPY[tier].status}
              </Badge>
              <span className={`rounded-pill bg-surface px-[var(--space-sm)] py-1 text-caption font-semibold ${TIER_CLASSES[tier].text}`}>
                {Math.round(frozenConfidenceScore)}% confidence
              </span>
              {realmId && (
                <span className="rounded-pill bg-surface px-[var(--space-sm)] py-1 text-caption font-semibold text-content-secondary">
                  QBO Realm: {realmId}
                </span>
              )}
            </div>

            <div className="flex items-start justify-between gap-[var(--space-md)]">
              <div className="flex min-w-0 items-start gap-[var(--space-sm)]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-nav-bg text-nav-text-active">
                  <Building2 size={22} strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-h2 font-extrabold text-content-primary">{invoice.vendor || "Select Vendor"}</p>
                  {cleanValue(invoice.invoiceNumber) && (
                    <p className="text-body-sm font-semibold text-content-secondary">Invoice #{invoice.invoiceNumber}</p>
                  )}
                  {cleanValue(invoice.invoiceDate) && (
                    <p className="text-caption text-content-secondary">
                      Date: {toDateInputValue(invoice.invoiceDate) || invoice.invoiceDate}
                      {cleanValue(invoice.dueDate) && ` · Due: ${toDateInputValue(invoice.dueDate) || invoice.dueDate}`}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-[var(--space-sm)]">
                <div className="text-right">
                  <p className="text-tiny font-bold uppercase tracking-wider text-content-secondary">Total Amount</p>
                  <p className="text-h1 font-black tracking-tight text-content-primary">{totalAmountDisplay}</p>
                </div>
                <ConfidenceRing percent={frozenConfidenceScore} tier={tier} />
              </div>
            </div>

            {isPendingReview && reasonDisplay && (
              <div className="mt-[var(--space-md)] rounded-md bg-surface p-[var(--space-sm)]">
                <div className="flex items-start gap-[var(--space-xs)]">
                  <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-status-danger-text" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-content-primary">Why this requires review</p>
                    <p className="mt-1 text-body-sm font-medium text-status-danger-text">{reasonDisplay.message}</p>
                    {reasonDisplay.isTranslated && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowTechnicalReason((v) => !v)}
                          className="mt-1 text-caption font-semibold text-content-secondary underline"
                        >
                          {showTechnicalReason ? "Hide technical details" : "Show technical details"}
                        </button>
                        {showTechnicalReason && (
                          <p className="mt-1 break-words text-caption text-content-secondary">{reasonDisplay.raw}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {vendorResolutionRequired &&
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
                  ))}
              </div>
            )}
          </div>

          {/* Invoice Information */}
          <SectionCard title="Invoice Information" badge={<Badge variant="neutral"></Badge>}>
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
            <FieldRow id="field-glAccountId" label="GL Code / Category" required>
              <div className="flex justify-end">
                <SelectDropdown uiSize="sm" error={fieldErrors.glAccountId} value={invoice.glAccountId} onChange={handleGlAccountChange} className="max-w-full">
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
            <FieldRow label="Tax Code">
              <div className="flex justify-end">
                <SelectDropdown uiSize="sm" value={invoice.taxCodeId} onChange={(e) => updateField("taxCodeId", e.target.value)}>
                  <option value="">
                    {taxCodesLoading
                      ? "Loading tax codes…"
                      : resolvedTaxCodeName ||
                        (!taxCodesError && taxCodes.length === 0 ? "No tax codes configured" : "Select Tax Code (optional)")}
                  </option>
                  {taxCodes.map((code) => (
                    <option key={getTaxCodeId(code)} value={getTaxCodeId(code)}>
                      {getTaxCodeName(code)}
                    </option>
                  ))}
                </SelectDropdown>
              </div>
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
            badge={<Badge variant={isBalanced ? "success" : "warning"}>{isBalanced ? "Balanced" : "Unbalanced"}</Badge>}
            defaultOpen={false}
            forceOpen={Boolean(fieldErrors.amountBeforeTax || fieldErrors.taxAmount || fieldErrors.totalAfterTax)}
          >
            <FieldRow id="field-amountBeforeTax" label="Before Tax" required>
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
            </FieldRow>
            <FieldRow id="field-taxAmount" label={taxRatePercent !== null ? `Tax (${taxRatePercent}%)` : "Tax"} required>
              <InlineEditField
                ariaLabel="Tax Amount"
                value={invoice.taxAmount}
                onCommit={(v) => updateField("taxAmount", v)}
                placeholder="Enter Tax Amount"
                inputMode="decimal"
                error={fieldErrors.taxAmount}
                formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                className="text-right"
              />
            </FieldRow>
            <FieldRow id="field-totalAfterTax" label="Total" required highlight>
              <InlineEditField
                ariaLabel="Total Amount"
                value={invoice.totalAfterTax}
                onCommit={(v) => updateField("totalAfterTax", v)}
                placeholder="Enter Total Amount"
                inputMode="decimal"
                error={fieldErrors.totalAfterTax}
                formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                className={`text-right text-h3 font-black ${TIER_CLASSES[tier].text}`}
              />
            </FieldRow>
            {/* <div className="flex items-center justify-between gap-[var(--space-md)] px-[var(--space-md)] py-[var(--space-sm)]">
              <span className="text-body-sm font-medium text-content-secondary">Subtotal + Tax</span>
              <Badge variant={isBalanced ? "success" : "warning"}>{Math.round(verifiedPercent)}% verified</Badge>
            </div> */}
          </SectionCard>

          {/* Line Items */}
          <SectionCard
            title={`Line Items (${lineItems.length})`}
            badge={<Badge variant="neutral">{lineItems.length} Extracted</Badge>}
            hint="Click a value or its pencil to inline edit."
          >
            <div className="flex flex-col gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)]">
              {lineItems.map((item, index) => (
                <div key={index} className="rounded-md border border-border p-[var(--space-sm)]">
                  <div className="flex items-start gap-[var(--space-sm)]">
                    <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-bg text-caption font-bold text-accent-text-on-bg">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <InlineEditField
                        ariaLabel={`Line item ${index + 1} description`}
                        value={item.description}
                        onCommit={(v) => updateLineItem(index, "description", v)}
                        placeholder="Item description"
                        className="font-semibold"
                      />
                      <div className="mt-[var(--space-xs)] flex flex-wrap items-center gap-[var(--space-xs)]">
                        <SelectDropdown
                          uiSize="sm"
                          value={item.glAccountId || ""}
                          onChange={(e) => updateLineItemGlAccount(index, e.target.value)}
                          className="text-tiny"
                        >
                          <option value="">GL: Unassigned</option>
                          {glAccounts.map((account) => (
                            <option key={account._id} value={account.qbAccountId}>
                              GL: {account.name}
                            </option>
                          ))}
                        </SelectDropdown>
                        {resolvedTaxCodeName && (
                          <span className="rounded-pill bg-surface-alt px-[var(--space-sm)] py-[2px] text-tiny font-semibold text-content-secondary">
                            Tax: {resolvedTaxCodeName}
                          </span>
                        )}
                      </div>
                    </div>
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
                      <InlineEditField
                        ariaLabel={`Line item ${index + 1} amount`}
                        value={String(item.amount)}
                        onCommit={(v) => updateLineItem(index, "amount", v)}
                        inputMode="decimal"
                        formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                        className="rounded-md bg-surface-alt font-bold"
                      />
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
          <SectionCard title={`Extra Charges (${extraCharges.length})`} defaultOpen={extraCharges.length > 0}>
            <div className="flex flex-col gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)]">
              {extraCharges.map((charge, index) => (
                <div key={index} className="rounded-md border border-border p-[var(--space-sm)]">
                  <div className="flex items-center gap-[var(--space-sm)]">
                    <InlineEditField
                      ariaLabel={`Extra charge ${index + 1} description`}
                      value={charge.description}
                      onCommit={(v) => updateExtraChargeDescription(index, v)}
                      placeholder="Charge description"
                      className="min-w-0 flex-1 font-semibold"
                    />
                    <InlineEditField
                      ariaLabel={`Extra charge ${index + 1} amount`}
                      value={String(charge.amount)}
                      onCommit={(v) => updateExtraChargeAmount(index, v)}
                      inputMode="decimal"
                      formatDisplay={(v) => formatDetailAmount(v || null, currencyForAmount)}
                      className={`w-28 shrink-0 rounded-md bg-surface-alt text-right font-extrabold ${TIER_CLASSES[tier].text}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeExtraCharge(index)}
                      aria-label="Remove extra charge"
                      className="shrink-0 text-content-muted hover:text-status-danger-text"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                  <label className="mt-[var(--space-xs)] flex items-center justify-between gap-[var(--space-sm)]">
                    <span className="shrink-0 text-caption text-content-secondary">Tax code</span>
                    <SelectDropdown
                      uiSize="sm"
                      value={charge.taxCodeId || ""}
                      onChange={(e) => updateExtraChargeTaxCode(index, e.target.value)}
                    >
                      <option value="">{taxCodesLoading ? "Loading…" : "Non-taxable (default)"}</option>
                      {taxCodes.map((code) => (
                        <option key={getTaxCodeId(code)} value={getTaxCodeId(code)}>
                          {getTaxCodeName(code)}
                        </option>
                      ))}
                    </SelectDropdown>
                  </label>
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
          className="hidden shrink-0 cursor-col-resize touch-none items-center justify-center self-stretch rounded-md hover:bg-surface-alt lg:flex lg:w-2"
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
          className="flex w-full min-w-0 flex-col gap-[var(--space-md)] lg:sticky lg:top-[var(--v2-header-h)] lg:w-[var(--v2-aside-w)] lg:shrink-0 lg:max-h-[calc(100vh_-_var(--v2-header-h))] lg:overflow-y-auto"
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
          <SectionCard title="Vendor Details" defaultOpen={false} forceOpen={Boolean(fieldErrors.vendor)}>
            <FieldRow id="field-vendor" label="Vendor Entity" required>
              {isPendingReview ? (
                // Falls back to the backend's own auto-match when the user
                // never went through the manual "Change vendor" flow — mirrors
                // the fallback chain submitToQuickBooks uses when posting.
                <div className="flex justify-end">
                  <SelectDropdown
                    uiSize="sm"
                    error={fieldErrors.vendor}
                    value={selectedVendor?._id || invoiceObject?.vendor?.vendorDbId || ""}
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
                placeholder="Enter Vendor Address"
              />
            </FieldRow>
            <FieldRow label="Bank & Wire Details" stacked>
              <InlineEditField
                ariaLabel="Vendor Bank Details"
                value={invoice.vendorBankDetails}
                onCommit={(v) => updateField("vendorBankDetails", v)}
                multiline
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

      {showConfidenceInfo && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/45 p-[var(--space-lg)]"
          onClick={() => setShowConfidenceInfo(false)}
        >
          <div className="w-full max-w-md cursor-auto rounded-2xl bg-surface p-[var(--space-lg)]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-h3 font-extrabold text-content-primary">Confidence Score</h2>
            <p className="mt-[var(--space-sm)] text-body-sm text-content-secondary">
              This score reflects how confident Scantrix is in the data extracted from your scanned invoice — things
              like the vendor, amounts, and invoice number.
            </p>
            <p className="mt-[var(--space-md)] rounded-md bg-surface-alt p-[var(--space-sm)] text-center text-caption text-content-secondary">
              Higher confidence scores indicate greater accuracy of extracted invoice data and require less manual
              review. If a field looks off, you can always correct it below before posting.
            </p>
            <button
              type="button"
              onClick={() => setShowConfidenceInfo(false)}
              className="mt-[var(--space-md)] h-12 w-full rounded-md bg-accent font-bold text-accent-ink hover:bg-accent-hover"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <VendorResolutionDialogV2
        invoiceId={invoiceId}
        open={vendorDialogOpen}
        onClose={() => setVendorDialogOpen(false)}
      />
    </div>
  );
}
