"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, ChevronDown, ChevronLeft, ChevronUp, Pencil, RotateCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { CSSProperties } from "react";
import { PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { deleteInvoice, getInvoiceDetails } from "@/store/invoice/invoiceApi";
import { fetchQuickBooksAccounts } from "@/store/quickBooks/quickBooksApi";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  formatDetailAmount,
  formatDetailDateTime,
  getDetailInvoiceUrl,
  resolveInvoiceDetailType,
  safeDetailValue,
} from "@/lib/invoiceDetailTheme";
import { getUserDisplayName, translateInvoiceReason } from "@/lib/invoiceDisplay";

// Zoom only applies to the <img> case — a PDF's own embedded viewer already
// has native zoom/scroll. Same constants as InvoiceReviewContentV2/
// InvoiceDetailContent (v1) — the scanned-copy viewer behaves identically
// everywhere it appears.
const SCAN_MIN_ZOOM = 1;
const SCAN_MAX_ZOOM = 3;
const SCAN_ZOOM_STEP = 0.5;

// Same drag-to-resize range as InvoiceReviewContentV2's Scanned Copy panel —
// kept identical so the viewer behaves the same wherever it appears.
const SCAN_PANEL_DEFAULT_HEIGHT = 480;
const SCAN_PANEL_MIN_HEIGHT = 280;
const SCAN_PANEL_MAX_HEIGHT = 1000;

// Same column-width resize range as InvoiceReviewContentV2's right-hand
// panel (Scanned Copy, Vendor Details, Status History all live in it).
const ASIDE_DEFAULT_WIDTH = 400;
const ASIDE_MIN_WIDTH = 300;
const ASIDE_MAX_WIDTH = 680;

type DetailType = "auto" | "manual" | "failed" | "pending";

// v2 counterpart of InvoiceDetailContent (v1)'s per-status THEME_CONFIG,
// remapped onto this app's real status tokens (status-success/warning/
// danger) instead of one-off hex — same mapping InvoiceReviewContentV2 uses
// for its confidence tiers, applied here to postedStatus instead.
const TYPE_CLASSES: Record<DetailType, { bg: string; border: string; text: string; badgeVariant: "success" | "warning" | "error" | "neutral"; label: string }> = {
  auto: { bg: "bg-status-success-bg", border: "border-status-success-border", text: "text-status-success-text", badgeVariant: "success", label: "Auto-Posted" },
  manual: { bg: "bg-status-warning-bg", border: "border-status-warning-border", text: "text-status-warning-text", badgeVariant: "warning", label: "Manually Posted" },
  failed: { bg: "bg-status-danger-bg", border: "border-status-danger-border", text: "text-status-danger-text", badgeVariant: "error", label: "Failed" },
  pending: { bg: "bg-surface-alt", border: "border-border", text: "text-content-secondary", badgeVariant: "neutral", label: "Pending" },
};

// Collapsible card shell — same accordion mechanics as
// InvoiceReviewContentV2's SectionCard, kept consistent across every v2
// screen that groups fields into named sections.
function SectionCard({
  title,
  badge,
  children,
  defaultOpen = true,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  );
}

function DetailRow({
  label,
  value,
  isLast,
  highlight,
  highlightClassName,
}: {
  label: string;
  value: string;
  isLast?: boolean;
  highlight?: boolean;
  highlightClassName?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-[var(--space-md)] px-[var(--space-md)] py-[var(--space-sm)] ${
        isLast ? "" : "border-b border-border"
      }`}
    >
      <span className="shrink-0 text-body-sm font-medium text-content-secondary">{label}</span>
      <span
        className={`min-w-0 flex-1 break-words text-right ${
          highlight ? `text-h3 font-black ${highlightClassName ?? ""}` : "text-body-sm font-bold text-content-primary"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// Read-only v2 counterpart of InvoiceDetailContent (v1) — same store/thunks
// and handlers, restyled onto dense v2 tokens/SectionCard so already-posted
// (auto/manual) and failed invoices opened from the v2 invoices list stay in
// the v2 experience instead of dropping back to the v1 page.
export function InvoiceDetailContentV2({ invoiceId }: { invoiceId: string }) {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const invoiceObject = useAppSelector((state) => state.invoice.selectedInvoice);
  const fetchError = useAppSelector((state) => state.invoice.error);
  const type = resolveInvoiceDetailType(invoiceObject?.postedStatus) as DetailType;
  const theme = TYPE_CLASSES[type];
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const deleting = useAppSelector((state) => state.invoice.deleting);

  const [scanLoading, setScanLoading] = useState(true);
  const [scanZoom, setScanZoom] = useState(1);
  const [scanPanelHeight, setScanPanelHeight] = useState(SCAN_PANEL_DEFAULT_HEIGHT);
  const scanResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Pointer capture (not document-level listeners) so the drag keeps
  // tracking the handle even when the cursor passes over the PDF <iframe> —
  // same approach as InvoiceReviewContentV2's Scanned Copy resize.
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

  // Sticky header's real rendered height — the aside panel sticks right
  // below it instead of at a fixed token offset, so the header can never
  // cover Vendor Details/Status History as the page scrolls. Same fix as
  // InvoiceReviewContentV2.
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

  // Drag-to-resize width for the right-hand panel.
  const [asideWidth, setAsideWidth] = useState(ASIDE_DEFAULT_WIDTH);
  const asideResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleAsideResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    asideResizeRef.current = { startX: event.clientX, startWidth: asideWidth };
  };

  const handleAsideResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!asideResizeRef.current) return;
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
    dispatch(getInvoiceDetails(invoiceId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  useEffect(() => {
    if (accessToken) dispatch(fetchQuickBooksAccounts({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Deleted/missing invoice (e.g. a stale link after deletion) — bounce back
  // to the list instead of leaving the user stuck on an infinite spinner.
  useEffect(() => {
    if (!fetchError || invoiceObject) return;
    showToast(typeof fetchError === "string" ? fetchError : "This invoice could not be found.", "error");
    router.replace("/v2/invoices");
  }, [fetchError, invoiceObject, router]);

  const rawData = invoiceObject?.extractedData;
  const statusHistory = invoiceObject?.statusHistory ?? [];
  const lineItems = rawData?.lineItems ?? [];
  const extraCharges = rawData?.extraCharges ?? [];

  const confidenceScore = Number.isFinite(Number(invoiceObject?.confidenceScore))
    ? Math.max(0, Math.min(100, Number(invoiceObject?.confidenceScore)))
    : null;

  const invoiceUrl = invoiceObject ? getDetailInvoiceUrl(invoiceObject) : undefined;
  const previewMimeType = invoiceObject?.file?.mimeType ?? "";
  const isPdf = previewMimeType.includes("pdf") || (invoiceUrl ?? "").toLowerCase().includes(".pdf");
  const driveFileUrl = invoiceObject?.googleDrive?.fileUrl;

  const resolvedGlAccount = useMemo(
    () => glAccounts.find((acc) => acc.qbAccountId === String(rawData?.glAccountId ?? "")),
    [glAccounts, rawData?.glAccountId],
  );

  const latestStatus = statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : null;
  const reasonDisplay = useMemo(() => translateInvoiceReason(latestStatus?.reason), [latestStatus]);
  const [showTechnicalReason, setShowTechnicalReason] = useState(false);

  const handleDeleteInvoice = async () => {
    const confirmed = await confirmDialog({
      title: "Delete this invoice?",
      message: "This will permanently delete the invoice and cannot be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;

    const result = await dispatch(deleteInvoice({ invoiceId }));
    if (deleteInvoice.fulfilled.match(result)) {
      showToast("Invoice deleted successfully.", "success");
      router.push("/v2/invoices?type=failed");
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to delete invoice.", "error");
    }
  };

  if (!invoiceObject) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  const vendorName = safeDetailValue(rawData?.vendorName);
  const invoiceNumber = safeDetailValue(rawData?.invoiceNumber);
  const invoiceDate = safeDetailValue(rawData?.invoiceDate);
  const dueDate = safeDetailValue(rawData?.dueDate);
  const currency = safeDetailValue(rawData?.currency);
  const currencyForAmount = currency === "—" ? "" : currency;
  const amountBeforeTax = formatDetailAmount(rawData?.amountBeforeTax, currencyForAmount);
  const taxAmount = formatDetailAmount(rawData?.taxAmount, currencyForAmount);
  const totalAfterTax = formatDetailAmount(rawData?.totalAmount, currencyForAmount);
  const vendorAddress = safeDetailValue(rawData?.vendorAddress);
  const vendorBankDetails = safeDetailValue(rawData?.bankingDetails);
  const glCode = safeDetailValue(resolvedGlAccount?.name);
  const itemDescriptions = safeDetailValue(rawData?.description);
  const uploadedByName = safeDetailValue(getUserDisplayName(invoiceObject?.uploadedBy));

  const previewHref = invoiceUrl
    ? `/invoices/preview?url=${encodeURIComponent(invoiceUrl)}&mimeType=${encodeURIComponent(previewMimeType)}`
    : null;

  return (
    <div className="w-full">
      {/* Header — kept slim, matching InvoiceReviewContentV2's compact bar. */}
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
          <h1 className="hidden text-caption font-bold uppercase tracking-wide text-content-secondary sm:inline">Invoice Detail</h1>
        </div>

        <div className="flex items-center gap-[var(--space-xs)]">
          {/* Editing (auto/manual) syncs the changes back to the linked
              QuickBooks bill but keeps the invoice under its current status —
              reuses the same review/edit screen a pending invoice posts
              through (InvoiceReviewContentV2), same as v1. */}
          {(type === "auto" || type === "manual") && (
            <button
              type="button"
              onClick={() => router.push(`/v2/invoices/${invoiceId}/review`)}
              className="inline-flex h-9 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-bold text-content-primary hover:bg-surface-alt"
            >
              <Pencil size={14} strokeWidth={2.25} />
              Edit
            </button>
          )}
          {type === "failed" && (
            <button
              type="button"
              onClick={() => void handleDeleteInvoice()}
              disabled={deleting}
              className="inline-flex h-9 items-center gap-[var(--space-xs)] rounded-md border border-status-danger-border bg-status-danger-bg px-[var(--space-sm)] text-caption font-bold text-status-danger-text disabled:opacity-45"
            >
              <Trash2 size={14} strokeWidth={2.25} />
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)] sm:gap-[var(--space-lg)] sm:p-[var(--space-lg)] lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-md)]">
          {/* Hero */}
          <div className={`relative overflow-hidden rounded-2xl border p-[var(--space-lg)] ${theme.bg} ${theme.border}`}>
            <div className="mb-[var(--space-md)] flex flex-wrap items-center gap-[var(--space-xs)]">
              <Badge variant={theme.badgeVariant}>{theme.label}</Badge>
              {confidenceScore !== null && (
                <span className={`rounded-pill bg-surface px-[var(--space-sm)] py-1 text-caption font-semibold ${theme.text}`}>
                  {Math.round(confidenceScore)}% confidence
                </span>
              )}
            </div>

            <div className="flex items-start gap-[var(--space-sm)]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-nav-bg text-nav-text-active">
                <Building2 size={22} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-h2 font-extrabold text-content-primary">{vendorName}</p>
                {invoiceNumber !== "—" && <p className="text-body-sm font-semibold text-content-secondary">Invoice #{invoiceNumber}</p>}
              </div>
            </div>

            <p className="mt-[var(--space-sm)] text-h1 font-black tracking-tight text-content-primary">{totalAfterTax}</p>

            {confidenceScore !== null && (
              <div className="mt-[var(--space-md)] h-1.5 overflow-hidden rounded-md bg-surface/60">
                <div className={`h-full rounded-md ${theme.text.replace("text-", "bg-")}`} style={{ width: `${Math.max(6, confidenceScore)}%` }} />
              </div>
            )}

            {type === "failed" && reasonDisplay && (
              <div className="mt-[var(--space-md)] rounded-md bg-surface p-[var(--space-sm)]">
                <div className="flex items-start gap-[var(--space-xs)]">
                  <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-status-danger-text" />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-medium text-status-danger-text">{reasonDisplay.message}</p>
                    {reasonDisplay.isTranslated && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowTechnicalReason((v) => !v)}
                          className="mt-1 text-caption font-semibold text-content-secondary underline"
                        >
                          {showTechnicalReason ? "Hide technical details" : "Show technical details"}
                        </button>
                        {showTechnicalReason && <p className="mt-1 break-words text-caption text-content-secondary">{reasonDisplay.raw}</p>}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Invoice Information */}
          <SectionCard title="Invoice Information">
            <DetailRow label="Invoice Number" value={invoiceNumber} />
            <DetailRow label="Invoice Date" value={invoiceDate} />
            <DetailRow label="Due Date" value={dueDate} />
            <DetailRow label="Currency" value={currency} />
            <DetailRow label="GL Code / Category" value={glCode} />
            <DetailRow label="Uploaded By" value={uploadedByName} isLast />
          </SectionCard>

          {/* Financial Summary */}
          <SectionCard title="Financial Summary" defaultOpen={false}>
            <DetailRow label="Amount Before Tax" value={amountBeforeTax} />
            <DetailRow label="Tax Amount" value={taxAmount} />
            <DetailRow label="Total Amount" value={totalAfterTax} highlight highlightClassName={theme.text} isLast />
          </SectionCard>

          {/* Vendor Details */}
          <SectionCard title="Vendor Details" defaultOpen={false}>
            <DetailRow label="Vendor Name" value={vendorName} />
            <DetailRow label="Vendor Address" value={vendorAddress} />
            <DetailRow label="Bank Details" value={vendorBankDetails} isLast />
          </SectionCard>

          {/* Item Descriptions */}
          {itemDescriptions !== "—" && (
            <SectionCard title="Item Descriptions" defaultOpen={false}>
              <p className="whitespace-pre-line break-words px-[var(--space-md)] py-[var(--space-md)] text-body-sm text-content-primary">{itemDescriptions}</p>
            </SectionCard>
          )}

          {/* Line Items */}
          {lineItems.length > 0 && (
            <SectionCard title={`Line Items (${lineItems.length})`}>
              {lineItems.map((item, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] ${
                    index < lineItems.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-bg text-caption font-bold text-accent-text-on-bg">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-semibold text-content-primary">{item.description}</p>
                    {(item.quantity || item.unitPrice) && (
                      <p className="text-caption text-content-secondary">
                        {item.quantity ? `Qty: ${item.quantity}` : ""}
                        {item.quantity && item.unitPrice ? "  ·  " : ""}
                        {item.unitPrice ? `Unit: ${formatDetailAmount(item.unitPrice)}` : ""}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 font-extrabold ${theme.text}`}>{formatDetailAmount(item.amount)}</span>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Extra Charges */}
          {extraCharges.length > 0 && (
            <SectionCard title={`Extra Charges (${extraCharges.length})`}>
              {extraCharges.map((charge, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] ${
                    index < extraCharges.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-bg text-caption font-bold text-accent-text-on-bg">
                    {index + 1}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-body-sm font-semibold text-content-primary">{charge.description || "Extra charge"}</p>
                  <span className={`shrink-0 font-extrabold ${theme.text}`}>{formatDetailAmount(charge.amount)}</span>
                </div>
              ))}
            </SectionCard>
          )}
        </div>

        {/* Column-width drag handle — matches InvoiceReviewContentV2's, so
            Scanned Copy, Vendor Details and Status History resize/align
            together with the whole right-hand column. */}
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
                {!isPdf && invoiceUrl && (
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
                    <span className="w-9 text-center text-caption font-semibold text-content-secondary">{Math.round(scanZoom * 100)}%</span>
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
                    it's still reachable after dragging the panel to its max
                    height. */}
                <button
                  type="button"
                  onClick={() => setScanPanelHeight(SCAN_PANEL_DEFAULT_HEIGHT)}
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
              {scanLoading && invoiceUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Spinner size="md" />
                </div>
              )}
              {invoiceUrl ? (
                isPdf ? (
                  <iframe src={invoiceUrl} title="Invoice scan" className="h-full w-full border-none" onLoad={() => setScanLoading(false)} />
                ) : scanZoom > 1 ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote S3 URL, not a static local asset next/image can optimize.
                  <img
                    src={invoiceUrl}
                    alt="Invoice scan"
                    style={{ width: `${scanZoom * 100}%`, maxWidth: "none" }}
                    onLoad={() => setScanLoading(false)}
                    onError={() => setScanLoading(false)}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote S3 URL, not a static local asset next/image can optimize.
                  <img
                    src={invoiceUrl}
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
              onDoubleClick={() => setScanPanelHeight(SCAN_PANEL_DEFAULT_HEIGHT)}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize scanned copy"
              title="Drag to resize · double-click to reset"
              className="flex h-3 shrink-0 cursor-ns-resize touch-none items-center justify-center border-t border-border bg-page hover:bg-surface-alt"
            >
              <span className="h-1 w-10 rounded-full bg-border-strong" />
            </div>
          </div>

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
    </div>
  );
}
