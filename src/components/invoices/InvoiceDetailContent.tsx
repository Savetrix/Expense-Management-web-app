"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, Pencil, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { deleteInvoice, getInvoiceDetails } from "@/store/invoice/invoiceApi";
import { fetchQuickBooksAccounts } from "@/store/quickBooks/quickBooksApi";
import { Spinner } from "@/components/ui/Spinner";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  INVOICE_DETAIL_THEME,
  formatDetailAmount,
  formatDetailDateTime,
  getDetailInvoiceUrl,
  resolveInvoiceDetailType,
  safeDetailValue,
} from "@/lib/invoiceDetailTheme";
import { getUserDisplayName, translateInvoiceReason } from "@/lib/invoiceDisplay";

// Zoom only applies to the <img> case — a PDF's own embedded viewer already
// has native zoom/scroll, and scaling an iframe's content from outside it
// isn't reliable across browsers anyway.
const SCAN_MIN_ZOOM = 1;
const SCAN_MAX_ZOOM = 3;
const SCAN_ZOOM_STEP = 0.5;

function SectionHeader({ title, bg, color }: { title: string; bg: string; color: string }) {
  return (
    <div className="px-[var(--space-md)] py-[var(--space-sm)] text-caption font-bold uppercase tracking-wide" style={{ backgroundColor: bg, color }}>
      {title}
    </div>
  );
}

function DetailRow({
  label,
  value,
  labelColor,
  dividerColor,
  isLast,
  highlight,
  highlightColor,
}: {
  label: string;
  value: string;
  labelColor: string;
  dividerColor: string;
  isLast?: boolean;
  highlight?: boolean;
  highlightColor?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-[var(--space-md)] px-[var(--space-md)] py-[var(--space-sm)]"
      style={!isLast ? { borderBottom: `1px solid ${dividerColor}` } : undefined}
    >
      <span className="shrink-0 text-body-sm font-medium" style={{ color: labelColor }}>
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 break-words text-right ${highlight ? "text-h3 font-black" : "text-body-sm font-bold text-text-primary"}`}
        style={highlight ? { color: highlightColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export function InvoiceDetailContent({ invoiceId }: { invoiceId: string }) {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const invoiceObject = useAppSelector((state) => state.invoice.selectedInvoice);
  const fetchError = useAppSelector((state) => state.invoice.error);
  const type = resolveInvoiceDetailType(invoiceObject?.postedStatus);
  const theme = INVOICE_DETAIL_THEME[type];
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const deleting = useAppSelector((state) => state.invoice.deleting);

  const [scanLoading, setScanLoading] = useState(true);
  const [scanZoom, setScanZoom] = useState(1);

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
    showToast(
      typeof fetchError === "string" ? fetchError : "This invoice could not be found.",
      "error",
    );
    router.replace("/invoices");
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
      router.push("/invoices?type=failed");
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to delete invoice.", "error");
    }
  };

  if (!invoiceObject) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-soft">
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
    <div className="min-h-screen" style={{ backgroundColor: theme.screenBg }}>
      <div className="mx-auto max-w-6xl p-[var(--space-lg)]">
        <div className="mb-[var(--space-md)] grid grid-cols-[1fr_auto_1fr] items-center">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="-my-[var(--space-sm)] inline-flex w-fit items-center gap-[var(--space-xs)] py-[var(--space-sm)] text-body-sm font-bold"
            style={{ color: theme.accentColor }}
          >
            <ChevronLeft size={20} strokeWidth={2.25} />
            Back
          </button>
          <span className="text-body-sm font-bold" style={{ color: theme.accentColor }}>
            Invoice detail
          </span>
          <span />
        </div>

        <div className="grid grid-cols-1 gap-[var(--space-lg)] lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <div className="flex flex-col gap-[var(--space-md)]">
            {/* Hero */}
            <div className="relative rounded-2xl px-[var(--space-lg)] pb-[var(--space-lg)] pt-[var(--space-md)]" style={{ backgroundColor: theme.cardBg }}>
              <div className="mb-[var(--space-xs)] flex flex-wrap items-center gap-[var(--space-sm)] pr-12">
                <span className="rounded-pill bg-white/70 px-[var(--space-sm)] py-1 text-caption font-bold" style={{ color: theme.accentColor }}>
                  {theme.statusLabel}
                </span>
                {confidenceScore !== null && (
                  <span className="rounded-pill bg-white/70 px-[var(--space-sm)] py-1 text-caption font-semibold" style={{ color: theme.accentColor }}>
                    {Math.round(confidenceScore)}% confidence
                  </span>
                )}
              </div>

              {/* Editing (auto/manual) syncs the changes back to the linked
                  QuickBooks bill but keeps the invoice under its current
                  status — the backend has no auto→manual transition on
                  edit, only on first posting a pending invoice. Reuses the
                  same editable-form screen a pending invoice is reviewed on
                  (InvoiceReviewContent), rather than an inline edit mode
                  here, so both edit flows look and behave identically. */}
              {(type === "auto" || type === "manual") && (
                <button
                  type="button"
                  onClick={() => router.push(`/invoices/${invoiceId}/review`)}
                  aria-label="Edit invoice"
                  className="absolute right-[var(--space-md)] top-[var(--space-md)] flex h-9 w-9 items-center justify-center rounded-full bg-white/75"
                  style={{ color: theme.accentColor }}
                >
                  <Pencil size={16} strokeWidth={2.25} />
                </button>
              )}
              {type === "failed" && (
                <button
                  type="button"
                  onClick={handleDeleteInvoice}
                  disabled={deleting}
                  aria-label="Delete invoice"
                  className="absolute right-[var(--space-md)] top-[var(--space-md)] flex h-9 w-9 items-center justify-center rounded-full bg-white/75 disabled:opacity-50"
                  style={{ color: theme.accentColor }}
                >
                  <Trash2 size={16} strokeWidth={2.25} />
                </button>
              )}

              <p className="text-h2 font-extrabold" style={{ color: theme.labelColor }}>
                {vendorName}
              </p>
              {invoiceNumber !== "—" && (
                <p className="font-semibold" style={{ color: theme.valueColor }}>
                  Invoice #{invoiceNumber}
                </p>
              )}

              <p className="mt-[var(--space-xs)] text-4xl font-black tracking-tight" style={{ color: theme.labelColor }}>
                {totalAfterTax}
              </p>

              {confidenceScore !== null && (
                <div className="mt-[var(--space-md)] h-1.5 overflow-hidden rounded-md bg-white/50">
                  <div
                    className="h-full rounded-md"
                    style={{ width: `${Math.max(6, confidenceScore)}%`, backgroundColor: theme.accentColor }}
                  />
                </div>
              )}

              {type === "failed" && reasonDisplay && (
                <div className="mt-[var(--space-sm)] flex items-start gap-[var(--space-xs)] rounded-md bg-white/70 p-[var(--space-sm)]">
                  <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-error" />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-medium text-error">{reasonDisplay.message}</p>
                    {reasonDisplay.isTranslated && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowTechnicalReason((v) => !v)}
                          className="mt-1 text-caption font-semibold text-error/80 underline"
                        >
                          {showTechnicalReason ? "Hide technical details" : "Show technical details"}
                        </button>
                        {showTechnicalReason && (
                          <p className="mt-1 break-words text-caption text-error/70">{reasonDisplay.raw}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Invoice Information */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <SectionHeader title="Invoice Information" bg={theme.sectionHeaderBg} color={theme.accentColor} />
              <DetailRow label="Invoice Number" value={invoiceNumber} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="Invoice Date" value={invoiceDate} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="Due Date" value={dueDate} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="Currency" value={currency} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="GL Code / Category" value={glCode} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="Uploaded By" value={uploadedByName} labelColor={theme.labelColor} dividerColor={theme.divider} isLast />
            </div>

            {/* Financial Summary */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <SectionHeader title="Financial Summary" bg={theme.sectionHeaderBg} color={theme.accentColor} />
              <DetailRow label="Amount Before Tax" value={amountBeforeTax} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="Tax Amount" value={taxAmount} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow
                label="Total Amount"
                value={totalAfterTax}
                labelColor={theme.labelColor}
                dividerColor={theme.divider}
                highlight
                highlightColor={theme.accentColor}
                isLast
              />
            </div>

            {/* Vendor Details */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <SectionHeader title="Vendor Details" bg={theme.sectionHeaderBg} color={theme.accentColor} />
              <DetailRow label="Vendor Name" value={vendorName} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="Vendor Address" value={vendorAddress} labelColor={theme.labelColor} dividerColor={theme.divider} />
              <DetailRow label="Bank Details" value={vendorBankDetails} labelColor={theme.labelColor} dividerColor={theme.divider} isLast />
            </div>

            {/* Item Descriptions */}
            {itemDescriptions !== "—" && (
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <SectionHeader title="Item Descriptions" bg={theme.sectionHeaderBg} color={theme.accentColor} />
                <p className="whitespace-pre-line break-words px-[var(--space-md)] py-[var(--space-md)] text-body-sm text-text-primary">
                  {itemDescriptions}
                </p>
              </div>
            )}

            {/* Line Items */}
            {lineItems.length > 0 && (
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <SectionHeader title={`Line Items (${lineItems.length})`} bg={theme.sectionHeaderBg} color={theme.accentColor} />
                {lineItems.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]"
                    style={index < lineItems.length - 1 ? { borderBottom: `1px solid ${theme.divider}` } : undefined}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-caption font-bold"
                      style={{ backgroundColor: theme.pillBg, color: theme.accentColor }}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-semibold text-text-primary">{item.description}</p>
                      {(item.quantity || item.unitPrice) && (
                        <p className="text-caption text-text-secondary">
                          {item.quantity ? `Qty: ${item.quantity}` : ""}
                          {item.quantity && item.unitPrice ? "  ·  " : ""}
                          {item.unitPrice ? `Unit: ${formatDetailAmount(item.unitPrice)}` : ""}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 font-extrabold" style={{ color: theme.accentColor }}>
                      {formatDetailAmount(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Extra Charges — separate from Line Items since they can carry
                their own tax treatment (see the review screen); read-only
                here, same as everything else on a posted invoice. */}
            {extraCharges.length > 0 && (
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <SectionHeader title={`Extra Charges (${extraCharges.length})`} bg={theme.sectionHeaderBg} color={theme.accentColor} />
                {extraCharges.map((charge, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]"
                    style={index < extraCharges.length - 1 ? { borderBottom: `1px solid ${theme.divider}` } : undefined}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-caption font-bold"
                      style={{ backgroundColor: theme.pillBg, color: theme.accentColor }}
                    >
                      {index + 1}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">
                      {charge.description || "Extra charge"}
                    </p>
                    <span className="shrink-0 font-extrabold" style={{ color: theme.accentColor }}>
                      {formatDetailAmount(charge.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-[var(--space-md)]">
            {/* Status History — same position for every invoice type */}
            {statusHistory.length > 0 && (
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <SectionHeader title="Status History" bg={theme.sectionHeaderBg} color={theme.accentColor} />
                <div className="flex flex-col gap-[var(--space-md)] px-[var(--space-md)] py-[var(--space-md)]">
                  {statusHistory.map((entry, index) => {
                    const isLast = index === statusHistory.length - 1;
                    const entryReason = translateInvoiceReason(entry.reason);
                    const changedByName = getUserDisplayName(entry.changedBy);
                    return (
                      <div key={index} className="flex gap-[var(--space-sm)]">
                        <span
                          className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2"
                          style={{
                            backgroundColor: isLast ? theme.accentColor : "#DDDDDD",
                            borderColor: isLast ? theme.accentColor : "#CCCCCC",
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-text-primary">
                            {entry.postedStatus ? entry.postedStatus.charAt(0).toUpperCase() + entry.postedStatus.slice(1) : "—"}
                          </p>
                          {(changedByName || entry.changedAt) && (
                            <p className="text-caption text-text-secondary">
                              {changedByName && `By ${changedByName}`}
                              {changedByName && entry.changedAt && "  ·  "}
                              {entry.changedAt && formatDetailDateTime(entry.changedAt)}
                            </p>
                          )}
                          {entryReason && (
                            <p className="text-caption font-semibold" style={{ color: theme.accentColor }}>
                              {entryReason.message}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Scanned copy */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <div
                className="flex flex-wrap items-center justify-between gap-x-[var(--space-md)] gap-y-[var(--space-xs)] px-[var(--space-md)] py-[var(--space-sm)]"
                style={{ backgroundColor: theme.sectionHeaderBg }}
              >
                <span className="text-caption font-bold uppercase tracking-wide" style={{ color: theme.accentColor }}>
                  Scanned Copy
                </span>
                <div className="flex flex-wrap items-center gap-[var(--space-md)]">
                  {!isPdf && invoiceUrl && (
                    <div className="flex items-center gap-[var(--space-xs)]">
                      <button
                        type="button"
                        onClick={() => setScanZoom((z) => Math.max(SCAN_MIN_ZOOM, z - SCAN_ZOOM_STEP))}
                        disabled={scanZoom <= SCAN_MIN_ZOOM}
                        aria-label="Zoom out"
                        className="-my-[var(--space-xs)] py-[var(--space-xs)] disabled:opacity-40"
                        style={{ color: theme.accentColor }}
                      >
                        <ZoomOut size={16} strokeWidth={2} />
                      </button>
                      <span className="w-9 text-center text-caption font-semibold" style={{ color: theme.accentColor }}>
                        {Math.round(scanZoom * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setScanZoom((z) => Math.min(SCAN_MAX_ZOOM, z + SCAN_ZOOM_STEP))}
                        disabled={scanZoom >= SCAN_MAX_ZOOM}
                        aria-label="Zoom in"
                        className="-my-[var(--space-xs)] py-[var(--space-xs)] disabled:opacity-40"
                        style={{ color: theme.accentColor }}
                      >
                        <ZoomIn size={16} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                  {driveFileUrl && (
                    <a
                      href={driveFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View in Google Drive"
                      className="-my-[var(--space-sm)] inline-flex items-center py-[var(--space-sm)]"
                    >
                      <BrandIcon name="google-drive" size={16} />
                    </a>
                  )}
                  {previewHref && (
                    <Link
                      href={previewHref}
                      className="-my-[var(--space-sm)] inline-flex items-center py-[var(--space-sm)] text-caption font-bold"
                      style={{ color: theme.accentColor }}
                    >
                      Open
                    </Link>
                  )}
                </div>
              </div>

              <div className={`relative h-[480px] bg-background-alt ${scanZoom > 1 ? "overflow-auto" : "overflow-hidden"}`}>
                {scanLoading && invoiceUrl && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Spinner size="md" />
                  </div>
                )}
                {invoiceUrl ? (
                  isPdf ? (
                    <iframe
                      src={invoiceUrl}
                      title="Invoice scan"
                      className="h-full w-full border-none"
                      onLoad={() => setScanLoading(false)}
                    />
                  ) : scanZoom > 1 ? (
                    // Zoomed: rendered at its natural aspect ratio and scaled
                    // by literal width, not transform:scale — that actually
                    // grows the element's layout box, so the container's
                    // overflow-auto above gets real scrollbars to pan with.
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
                    <p className="text-body-sm text-text-secondary">No scanned copy available for this invoice.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
