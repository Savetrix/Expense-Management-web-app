"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Pencil, ZoomIn, ZoomOut } from "lucide-react";
import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getInvoiceDetails,
  getInvoices,
  postInvoiceToQuickBooks,
  rejectInvoice,
  updateInvoiceExtractedData,
} from "@/store/invoice/invoiceApi";
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
import { getReviewTheme } from "@/lib/invoiceReviewTheme";
import { taxCodeId as getTaxCodeId, taxCodeName as getTaxCodeName } from "@/lib/quickbooks/taxCode";
import { Spinner } from "@/components/ui/Spinner";

// Zoom only applies to the <img> case — a PDF's own embedded viewer already
// has native zoom/scroll, and scaling an iframe's content from outside it
// isn't reliable across browsers anyway. Ported from InvoiceDetailContent so
// the two screens' scanned-copy viewers behave identically.
const SCAN_MIN_ZOOM = 1;
const SCAN_MAX_ZOOM = 3;
const SCAN_ZOOM_STEP = 0.5;

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

// Extracted dates can arrive in whatever format the scan produced (ISO,
// "Jan 15, 2026", "01/15/2026", ...). `<input type="date">` only accepts an
// exact YYYY-MM-DD value, so this normalizes what it can and returns "" for
// anything it can't confidently parse — the raw extracted text is then shown
// as a hint below the (now-blank) picker rather than silently discarded.
// Once a user picks or types a date through the picker, its value is always
// YYYY-MM-DD, which is how the format gets fixed going forward.
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

// Field names in the authoritative ported contract (invoiceSlice.ts's
// ExtractedData / invoiceApi.ts's PostInvoiceExtractedData) — not mobile's
// older RawInvoiceData shape, which has since drifted (e.g. `itemDescriptions`
// as an array was replaced by a single `description` string; `vendorBankDetails`
// was replaced by `bankingDetails` to match the real API field name).
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

function SectionHeader({
  title,
  bg,
  color,
  editable,
}: {
  title: string;
  bg: string;
  color: string;
  editable?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-[var(--space-xs)] px-[var(--space-md)] py-[var(--space-sm)] text-caption font-bold uppercase tracking-wide"
      style={{ backgroundColor: bg, color }}
    >
      {title}
      {editable && <Pencil size={12} strokeWidth={2.25} className="opacity-60" />}
    </div>
  );
}

// Same label-left/value-right row the read-only invoice detail screen uses,
// but the value slot takes an editable control instead of static text — this
// is what makes this screen look like InvoiceDetailContent while staying a
// form. `stacked` puts the control on its own line below the label, for
// multiline fields (address, bank details, item descriptions).
function EditableRow({
  id,
  label,
  labelColor,
  dividerColor,
  isLast,
  error,
  stacked,
  highlight,
  editable,
  children,
}: {
  id?: string;
  label: string;
  labelColor: string;
  dividerColor: string;
  isLast?: boolean;
  error?: string;
  stacked?: boolean;
  highlight?: boolean;
  editable?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 px-[var(--space-md)] py-[var(--space-sm)]"
      style={!isLast ? { borderBottom: `1px solid ${dividerColor}` } : undefined}
    >
      <div className={stacked ? "flex flex-col gap-[var(--space-xs)]" : "flex items-center justify-between gap-[var(--space-md)]"}>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-body-sm font-medium ${error ? "font-bold text-error" : ""} ${highlight ? "self-center" : ""}`}
          style={!error ? { color: labelColor } : undefined}
        >
          {label}
          {editable && <Pencil size={12} strokeWidth={2.25} className="opacity-60" />}
        </span>
        <div className={stacked ? "w-full" : "min-w-0 flex-1"}>{children}</div>
      </div>
      {error && <p className="mt-[var(--space-xs)] text-caption font-semibold text-error">{error}</p>}
    </div>
  );
}

const INPUT_CLASS =
  "w-full bg-transparent text-right text-body-sm font-bold text-text-primary focus:outline-none placeholder:font-normal placeholder:text-text-secondary/50";
const TEXTAREA_CLASS =
  "w-full resize-none rounded-md border border-border bg-background-alt p-[var(--space-sm)] text-body-sm font-medium text-text-primary focus:outline-none";

export function InvoiceReviewContent({ invoiceId }: { invoiceId: string }) {
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
  // A vendor resolution belongs to ONE invoice. Reading it unconditionally is
  // how a vendor resolved on a previous invoice became the vendor posted to
  // QuickBooks for this one: the resolution outlived the screen that made it,
  // and only the Pending list cleared it, so arriving from the Invoices list
  // inherited it silently. Gated here as well as cleared in the mount effect
  // below, because the first render happens before that effect runs.
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

  useEffect(() => {
    // Drop any resolution left behind by a different invoice before it can be
    // used as this invoice's vendor.
    dispatch(clearVendorResolutionForOtherInvoice(invoiceId));
    dispatch(getInvoiceDetails(invoiceId));
    // Pull the full invoice list so the pre-post duplicate-number check below
    // can compare against every invoice this tab knows about (list screens and
    // the scan pipeline populate the same slice). Without this, a re-scan of a
    // failed upload would never see the earlier record and could post twice.
    dispatch(getInvoices());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  useEffect(() => {
    if (!accessToken) return;
    // Sequential, not parallel: three near-simultaneous requests sharing the
    // same QuickBooks connection can race a backend token refresh (each
    // reads the same refresh token before either writes back the rotated
    // one). Awaiting each in turn avoids ever having more than one in
    // flight for this connection at a time.
    (async () => {
      await dispatch(fetchQuickBooksVendors({ accessToken }));
      await dispatch(fetchQuickBooksAccounts({ accessToken }));
      await dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const rawData = invoiceObject?.extractedData || {};
  // Reachable for two different flows now: a pending invoice's actual review
  // (reject/post-to-QuickBooks), and the "edit" pencil on an already-posted
  // (auto/manual) invoice's detail page — the latter just needs to patch
  // fields in place via updateInvoiceExtractedData, not re-run the
  // post/reject decision, so most of the pending-only UI below is gated on
  // isPendingReview.
  const invoiceType = resolveInvoiceDetailType(invoiceObject?.postedStatus);
  const isPendingReview = invoiceType === "pending";
  const confidenceScore = Number.isFinite(Number(invoiceObject?.confidenceScore))
    ? Math.max(0, Math.min(100, Number(invoiceObject?.confidenceScore)))
    : 0;
  const [frozenConfidenceScore] = useState(confidenceScore);
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

  const [invoice, setInvoice] = useState<NormalizedInvoiceData>(() => normalizeInvoiceData(rawData));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(() =>
    getInitialFieldErrors(normalizeInvoiceData(rawData)),
  );
  const [showConfidenceInfo, setShowConfidenceInfo] = useState(false);

  useEffect(() => {
    const normalized = normalizeInvoiceData(invoiceObject?.extractedData || {});
    if (selectedVendor?.displayName) normalized.vendor = selectedVendor.displayName;
    else if (createdVendor?.name) normalized.vendor = createdVendor.name;
    // The extracted data never had a GL account when the vendor couldn't be
    // matched (that's why resolution was required in the first place), so
    // once resolved, fall back to the vendor's own default GL account/tax
    // code rather than leaving the invoice's copy empty.
    if (!normalized.glAccountId) {
      normalized.glAccountId = selectedVendor?.glAccountId || createdVendor?.glAccountId || "";
    }
    if (!normalized.taxCodeId) {
      normalized.taxCodeId = selectedVendor?.taxCodeId || createdVendor?.taxCodeId || "";
    }
    setInvoice(normalized);
    setFieldErrors(getInitialFieldErrors(normalized));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceObject, selectedVendor, createdVendor]);

  const updateField = (key: keyof NormalizedInvoiceData, value: string) => {
    setInvoice((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const theme = useMemo(() => getReviewTheme(frozenConfidenceScore), [frozenConfidenceScore]);

  const resolvedGlAccountName = useMemo(
    () => glAccounts.find((acc) => acc.qbAccountId === invoice.glAccountId)?.name || "",
    [glAccounts, invoice.glAccountId],
  );

  const resolvedTaxCodeName = useMemo(() => {
    const match = taxCodes.find((code) => getTaxCodeId(code) === invoice.taxCodeId);
    return match ? getTaxCodeName(match) : "";
  }, [taxCodes, invoice.taxCodeId]);

  const previewUrl =
    invoiceObject?.file?.s3Url || (invoiceObject as unknown as { s3Url?: string })?.s3Url;
  const previewMimeType = invoiceObject?.file?.mimeType || "";
  const isPdf = previewMimeType.includes("pdf") || (previewUrl ?? "").toLowerCase().includes(".pdf");
  const driveFileUrl = invoiceObject?.googleDrive?.fileUrl;
  const previewHref = previewUrl
    ? `/invoices/preview?url=${encodeURIComponent(previewUrl)}&mimeType=${encodeURIComponent(previewMimeType)}`
    : null;

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
      router.push("/invoices/pending");
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to reject the invoice.", "error");
    }
  };

  const submitToQuickBooks = async () => {
    // Both the "select existing vendor" and "create new vendor" paths on the
    // vendor-resolution page dispatch setSelectedVendor with a real _id, so
    // that's the only fallback chain that's ever actually reachable here —
    // mobile's InvoiceReviewScreen additionally referenced
    // createdVendor?.vendorDbId, but CreatedVendor (vendorSlice.ts) has no
    // such field; that branch was already dead code there.
    const vendorId = selectedVendor?._id || selectedVendor?.qbVendorId || invoiceObject?.vendor?.vendorDbId || "";

    if (!vendorId) {
      showToast("Could not find vendor ID. Please resolve the vendor first.", "error");
      return;
    }

    const result = await dispatch(
      postInvoiceToQuickBooks({
        invoiceId,
        vendorId,
        extractedData: {
          vendorName: cleanValue(invoice.vendor),
          currency: cleanValue(invoice.currency),
          invoiceNumber: cleanValue(invoice.invoiceNumber),
          amountBeforeTax: Number(invoice.amountBeforeTax) || 0,
          taxAmount: Number(invoice.taxAmount) || 0,
          totalAmount: Number(invoice.totalAfterTax) || 0,
          lineItems: rawData.lineItems || [],
          description: cleanValue(invoice.itemDescriptionsText) || null,
          vendorAddress: cleanValue(invoice.vendorAddress) || null,
          bankingDetails: cleanValue(invoice.vendorBankDetails) || null,
          glAccountId: cleanValue(invoice.glAccountId) || null,
          taxCodeId: cleanValue(invoice.taxCodeId) || null,
        },
      }),
    );

    if (postInvoiceToQuickBooks.fulfilled.match(result)) {
      showToast("Invoice posted to QuickBooks successfully.", "success");
      router.push("/invoices/pending");
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
      document.getElementById(`field-${errorKeys[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (vendorResolutionRequired && !vendorIsResolved) {
      const confirmed = await confirmDialog({
        title: "Vendor not registered",
        message: "This vendor is not registered in QuickBooks. Resolve the vendor now?",
        confirmLabel: "Resolve vendor",
      });
      if (confirmed) router.push(`/invoices/${invoiceId}/vendor`);
      return;
    }

    // Duplicate-invoice warning. QuickBooks rejects duplicate invoice numbers
    // per vendor (WebhooksError 6140), and the scan pipeline isn't
    // transactional — a re-scan of a "failed" upload creates a whole new
    // invoice record, which then posts a second bill for the same underlying
    // invoice.
    //
    // Fetched fresh rather than read off the cached list: the mount-time fetch
    // may not have landed yet (post within a second of opening this screen), and
    // a duplicate created in another tab or by the scan pipeline would not be in
    // this tab's copy at all. If the fetch fails we fall back to the cached list
    // rather than blocking a legitimate post.
    let candidates = allInvoices;
    try {
      const refreshed = await dispatch(getInvoices());
      if (getInvoices.fulfilled.match(refreshed) && Array.isArray(refreshed.payload)) {
        candidates = refreshed.payload as typeof allInvoices;
      }
    } catch {
      // keep the cached list
    }

    // Matched on vendor + invoice number ONLY. Requiring the amount to match too
    // meant OCR reading the total even slightly differently on the re-scan let a
    // real duplicate through — and the amount is not what QuickBooks rejects on.
    // This is a warning with a "Post anyway", so erring toward asking is right.
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

  // Edit path for an already-posted (auto/manual) invoice, reached via the
  // detail page's pencil button — patches fields in place via
  // updateInvoiceExtractedData rather than re-posting, and deliberately
  // never sends vendorName (it's tied to the already-linked QB vendor
  // record, and this screen's vendor field is read-only outside pending
  // review, so there's nothing new to send).
  const isSaveDisabled = updatingExtractedData;

  const handleSaveChanges = async () => {
    const errors = validateQuickBooksFields();
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      setFieldErrors(errors);
      showToast(errors[errorKeys[0]] || "Please fill in the required fields.", "error");
      document.getElementById(`field-${errorKeys[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const result = await dispatch(
      updateInvoiceExtractedData({
        invoiceId,
        extractedData: {
          currency: cleanValue(invoice.currency),
          invoiceNumber: cleanValue(invoice.invoiceNumber),
          invoiceDate: cleanValue(invoice.invoiceDate) || null,
          dueDate: cleanValue(invoice.dueDate) || null,
          amountBeforeTax: Number(invoice.amountBeforeTax) || 0,
          taxAmount: Number(invoice.taxAmount) || 0,
          totalAmount: Number(invoice.totalAfterTax) || 0,
          lineItems: rawData.lineItems || [],
          description: cleanValue(invoice.itemDescriptionsText) || null,
          vendorAddress: cleanValue(invoice.vendorAddress) || null,
          bankingDetails: cleanValue(invoice.vendorBankDetails) || null,
          glAccountId: cleanValue(invoice.glAccountId) || null,
          taxCodeId: cleanValue(invoice.taxCodeId) || null,
        },
      }),
    );

    if (updateInvoiceExtractedData.fulfilled.match(result)) {
      showToast("Invoice updated and synced to QuickBooks.", "success");
      router.push(`/invoices/${invoiceId}`);
    } else {
      const payload = result.payload as { message?: string } | string | undefined;
      showToast(typeof payload === "string" ? payload : payload?.message || "Failed to update invoice.", "error");
    }
  };

  if (!invoiceObject) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-soft">
        <Spinner size="md" />
      </div>
    );
  }

  const currencyForAmount = cleanValue(invoice.currency);
  const totalAmountDisplay = formatDetailAmount(invoice.totalAfterTax || null, currencyForAmount);

  return (
    <div className="min-h-screen" style={{ backgroundColor: theme.screenBg }}>
      <div className="mx-auto max-w-6xl p-[var(--space-lg)]">
        <div className="mb-[var(--space-md)] grid grid-cols-[1fr_auto_1fr] items-center">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="-my-[var(--space-sm)] inline-flex w-fit items-center gap-[var(--space-xs)] py-[var(--space-sm)] text-body-sm font-bold"
            style={{ color: theme.headerBg }}
          >
            <ChevronLeft size={20} strokeWidth={2.25} />
            Back
          </button>
          <span className="text-body-sm font-bold" style={{ color: theme.headerBg }}>
            {isPendingReview ? "Invoice Review" : "Edit Invoice"}
          </span>
          <div className="flex justify-self-end gap-[var(--space-xs)]">
            {isPendingReview ? (
              <>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={isRejectDisabled}
                  className="h-9 rounded-lg border border-error/30 bg-error/10 px-[var(--space-sm)] text-caption font-bold text-error disabled:opacity-45"
                >
                  {rejecting ? "Rejecting…" : "Reject"}
                </button>
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  disabled={isPostDisabled}
                  className="h-9 rounded-lg bg-primary px-[var(--space-sm)] text-caption font-bold text-text-primary hover:opacity-90 disabled:opacity-45"
                >
                  {posting ? "Posting…" : theme.actionText}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleSaveChanges}
                disabled={isSaveDisabled}
                className="h-9 rounded-lg bg-primary px-[var(--space-sm)] text-caption font-bold text-text-primary hover:opacity-90 disabled:opacity-45"
              >
                {updatingExtractedData ? "Saving…" : "Save Changes"}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-[var(--space-lg)] lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <div className="flex flex-col gap-[var(--space-md)]">
            {/* Hero */}
            <div className="relative rounded-2xl px-[var(--space-lg)] pb-[var(--space-lg)] pt-[var(--space-md)]" style={{ backgroundColor: theme.cardBg }}>
              <div className="mb-[var(--space-xs)] flex flex-wrap items-center gap-[var(--space-sm)] pr-10">
                <span className="rounded-pill bg-white/70 px-[var(--space-sm)] py-1 text-caption font-bold" style={{ color: theme.primaryText }}>
                  {theme.statusText}
                </span>
                <span className="rounded-pill bg-white/70 px-[var(--space-sm)] py-1 text-caption font-semibold" style={{ color: theme.primaryText }}>
                  {Math.round(frozenConfidenceScore)}% confidence
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowConfidenceInfo(true)}
                aria-label="How is this score calculated?"
                className="absolute right-[var(--space-md)] top-[var(--space-md)] flex h-8 w-8 items-center justify-center rounded-full bg-white/75 font-extrabold"
                style={{ color: theme.primaryText }}
              >
                ?
              </button>

              <p className="text-h2 font-extrabold" style={{ color: theme.primaryText }}>
                {invoice.vendor || "Select Vendor"}
              </p>
              {cleanValue(invoice.invoiceNumber) && (
                <p className="font-semibold" style={{ color: theme.valueText }}>
                  Invoice #{invoice.invoiceNumber}
                </p>
              )}

              <p className="mt-[var(--space-xs)] text-4xl font-black tracking-tight" style={{ color: theme.primaryText }}>
                {totalAmountDisplay}
              </p>

              <div className="mt-[var(--space-md)] h-1.5 overflow-hidden rounded-md bg-white/50">
                <div
                  className="h-full rounded-md"
                  style={{ width: `${Math.max(6, Math.min(frozenConfidenceScore, 100))}%`, backgroundColor: theme.progressFill }}
                />
              </div>

              {isPendingReview && reasonDisplay && (
                <div className="mt-[var(--space-sm)] rounded-md bg-white/70 p-[var(--space-sm)]">
                  <div className="flex items-start gap-[var(--space-xs)]">
                    <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-error" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-text-primary">Why this requires review</p>
                      <p className="mt-1 text-body-sm font-medium text-error">{reasonDisplay.message}</p>
                      {reasonDisplay.isTranslated && (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowTechnicalReason((v) => !v)}
                            className="mt-1 text-caption font-semibold text-text-secondary underline"
                          >
                            {showTechnicalReason ? "Hide technical details" : "Show technical details"}
                          </button>
                          {showTechnicalReason && (
                            <p className="mt-1 break-words text-caption text-text-secondary">{reasonDisplay.raw}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {vendorResolutionRequired &&
                    (vendorIsResolved ? (
                      <div className="mt-[var(--space-sm)] flex items-center justify-between gap-[var(--space-sm)] rounded-md border border-[#B6E8D3] bg-[#EAF7F1] px-[var(--space-sm)] py-[var(--space-xs)]">
                        <span className="flex min-w-0 items-center gap-[var(--space-xs)] text-body-sm font-semibold text-[#15805D]">
                          <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" />
                          <span className="truncate">
                            Vendor resolved: {selectedVendor?.displayName || createdVendor?.name}
                          </span>
                        </span>
                        <Link href={`/invoices/${invoiceId}/vendor`} className="shrink-0 text-body-sm font-bold text-primary">
                          Change
                        </Link>
                      </div>
                    ) : (
                      <Link
                        href={`/invoices/${invoiceId}/vendor`}
                        className="mt-[var(--space-sm)] flex items-center justify-between border-t border-[#EFEFEF] pt-[var(--space-sm)] font-semibold"
                        style={{ color: theme.primaryText }}
                      >
                        <span>+ Resolve Vendor</span>
                        <ChevronRight size={18} strokeWidth={2} />
                      </Link>
                    ))}
                </div>
              )}
            </div>

            {/* Invoice Information */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <SectionHeader title="Invoice Information" bg={theme.sectionHeaderBg} color={theme.headerBg} />
              <EditableRow id="field-invoiceNumber" label="Invoice Number" labelColor={theme.primaryText} dividerColor={theme.divider} error={fieldErrors.invoiceNumber} editable>
                <input
                  value={invoice.invoiceNumber}
                  onChange={(e) => updateField("invoiceNumber", e.target.value)}
                  placeholder="Enter Invoice Number"
                  className={INPUT_CLASS}
                />
              </EditableRow>
              <EditableRow label="Invoice Date" labelColor={theme.primaryText} dividerColor={theme.divider}>
                <input
                  type="date"
                  value={toDateInputValue(invoice.invoiceDate)}
                  onChange={(e) => updateField("invoiceDate", e.target.value)}
                  className={INPUT_CLASS}
                />
                {!toDateInputValue(invoice.invoiceDate) && cleanValue(invoice.invoiceDate) && (
                  <p className="mt-1 text-right text-caption text-text-secondary">
                    Extracted: {invoice.invoiceDate} — pick a date above to fix the format
                  </p>
                )}
              </EditableRow>
              <EditableRow label="Due Date" labelColor={theme.primaryText} dividerColor={theme.divider}>
                <input
                  type="date"
                  value={toDateInputValue(invoice.dueDate)}
                  onChange={(e) => updateField("dueDate", e.target.value)}
                  className={INPUT_CLASS}
                />
                {!toDateInputValue(invoice.dueDate) && cleanValue(invoice.dueDate) && (
                  <p className="mt-1 text-right text-caption text-text-secondary">
                    Extracted: {invoice.dueDate} — pick a date above to fix the format
                  </p>
                )}
              </EditableRow>
              <EditableRow id="field-currency" label="Currency" labelColor={theme.primaryText} dividerColor={theme.divider} error={fieldErrors.currency}>
                <select
                  value={invoice.currency}
                  onChange={(e) => updateField("currency", e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="" disabled>
                    Select Currency
                  </option>
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </EditableRow>
              <EditableRow id="field-glAccountId" label="GL Code / Category" labelColor={theme.primaryText} dividerColor={theme.divider} error={fieldErrors.glAccountId}>
                <select value={invoice.glAccountId} onChange={handleGlAccountChange} className={INPUT_CLASS}>
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
                </select>
                {glAccountsErrorDisplay && (
                  <div className="mt-[var(--space-xs)] text-right">
                    <p className="text-caption font-semibold text-error">
                      Couldn&apos;t load GL accounts — {glAccountsErrorDisplay.message}
                    </p>
                    {glAccountsErrorDisplay.isTranslated && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowGlAccountsErrorDetails((v) => !v)}
                          className="mt-1 text-caption font-semibold text-text-secondary underline"
                        >
                          {showGlAccountsErrorDetails ? "Hide technical details" : "Show technical details"}
                        </button>
                        {showGlAccountsErrorDetails && (
                          <p className="mt-1 break-words text-caption text-text-secondary">{glAccountsErrorDisplay.raw}</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </EditableRow>
              <EditableRow label="Tax Code" labelColor={theme.primaryText} dividerColor={theme.divider} isLast>
                <select
                  value={invoice.taxCodeId}
                  onChange={(e) => updateField("taxCodeId", e.target.value)}
                  className={INPUT_CLASS}
                >
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
                </select>
                {taxCodesErrorDisplay && (
                  <div className="mt-[var(--space-xs)] text-right">
                    <p className="text-caption font-semibold text-error">
                      Couldn&apos;t load tax codes — {taxCodesErrorDisplay.message}
                    </p>
                    {taxCodesErrorDisplay.isTranslated && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowTaxCodesErrorDetails((v) => !v)}
                          className="mt-1 text-caption font-semibold text-text-secondary underline"
                        >
                          {showTaxCodesErrorDetails ? "Hide technical details" : "Show technical details"}
                        </button>
                        {showTaxCodesErrorDetails && (
                          <p className="mt-1 break-words text-caption text-text-secondary">{taxCodesErrorDisplay.raw}</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </EditableRow>
            </div>

            {/* Financial Summary */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <SectionHeader title="Financial Summary" bg={theme.sectionHeaderBg} color={theme.headerBg} />
              <EditableRow id="field-amountBeforeTax" label="Amount Before Tax" labelColor={theme.primaryText} dividerColor={theme.divider} error={fieldErrors.amountBeforeTax} editable>
                <input
                  value={invoice.amountBeforeTax}
                  onChange={(e) => updateField("amountBeforeTax", e.target.value)}
                  placeholder="Enter Amount Before Tax"
                  inputMode="decimal"
                  className={INPUT_CLASS}
                />
              </EditableRow>
              <EditableRow id="field-taxAmount" label="Tax Amount" labelColor={theme.primaryText} dividerColor={theme.divider} error={fieldErrors.taxAmount} editable>
                <input
                  value={invoice.taxAmount}
                  onChange={(e) => updateField("taxAmount", e.target.value)}
                  placeholder="Enter Tax Amount"
                  inputMode="decimal"
                  className={INPUT_CLASS}
                />
              </EditableRow>
              <EditableRow
                id="field-totalAfterTax"
                label="Total Amount"
                labelColor={theme.primaryText}
                dividerColor={theme.divider}
                error={fieldErrors.totalAfterTax}
                highlight
                editable
                isLast
              >
                <input
                  value={invoice.totalAfterTax}
                  onChange={(e) => updateField("totalAfterTax", e.target.value)}
                  placeholder="Enter Total Amount"
                  inputMode="decimal"
                  className={`${INPUT_CLASS} text-h3 font-black`}
                  style={{ color: theme.headerBg }}
                />
              </EditableRow>
            </div>

            {/* Vendor Details */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <SectionHeader title="Vendor Details" bg={theme.sectionHeaderBg} color={theme.headerBg} />
              <EditableRow id="field-vendor" label="Vendor" labelColor={theme.primaryText} dividerColor={theme.divider} error={fieldErrors.vendor}>
                {isPendingReview ? (
                  <select value={selectedVendor?._id || ""} onChange={handleVendorChange} className={INPUT_CLASS}>
                    {/* A neutral placeholder, not an echo of the current
                        value: the select already renders its own selection, so
                        printing invoice.vendor here made the chosen vendor
                        appear twice — once disabled, once as a live option. */}
                    <option value="" disabled>
                      Select Vendor
                    </option>
                    {vendors.map((vendor) => (
                      <option key={vendor._id} value={vendor._id}>
                        {vendor.displayName}
                      </option>
                    ))}
                  </select>
                ) : (
                  // Not editable here — the vendor is already linked to a QB
                  // vendor record, and this screen has no picker that could
                  // safely change that link (matches the old inline-edit
                  // form on the detail page, which excluded vendor for the
                  // same reason).
                  <span className="block w-full text-right text-body-sm font-bold text-text-primary">
                    {invoice.vendor || "—"}
                  </span>
                )}
              </EditableRow>
              <EditableRow label="Vendor Address" labelColor={theme.primaryText} dividerColor={theme.divider} stacked editable>
                <textarea
                  value={invoice.vendorAddress}
                  onChange={(e) => updateField("vendorAddress", e.target.value)}
                  placeholder="Enter Vendor Address"
                  rows={2}
                  className={TEXTAREA_CLASS}
                />
              </EditableRow>
              <EditableRow label="Bank Details" labelColor={theme.primaryText} dividerColor={theme.divider} stacked editable isLast>
                <textarea
                  value={invoice.vendorBankDetails}
                  onChange={(e) => updateField("vendorBankDetails", e.target.value)}
                  placeholder="Enter Vendor Bank Details"
                  rows={2}
                  className={TEXTAREA_CLASS}
                />
              </EditableRow>
            </div>

            {/* Item Descriptions */}
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <SectionHeader title="Item Descriptions" bg={theme.sectionHeaderBg} color={theme.headerBg} editable />
              <div className="px-[var(--space-md)] py-[var(--space-md)]">
                <textarea
                  value={invoice.itemDescriptionsText}
                  onChange={(e) => updateField("itemDescriptionsText", e.target.value)}
                  placeholder="Enter Item Descriptions"
                  rows={3}
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-[var(--space-md)]">
            {/* Status History */}
            {statusHistory.length > 0 && (
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <SectionHeader title="Status History" bg={theme.sectionHeaderBg} color={theme.headerBg} />
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
                            backgroundColor: isLast ? theme.headerBg : "#DDDDDD",
                            borderColor: isLast ? theme.headerBg : "#CCCCCC",
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
                            <p className="text-caption font-semibold" style={{ color: theme.headerBg }}>
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
                <span className="text-caption font-bold uppercase tracking-wide" style={{ color: theme.headerBg }}>
                  Scanned Copy
                </span>
                <div className="flex flex-wrap items-center gap-[var(--space-md)]">
                  {!isPdf && previewUrl && (
                    <div className="flex items-center gap-[var(--space-xs)]">
                      <button
                        type="button"
                        onClick={() => setScanZoom((z) => Math.max(SCAN_MIN_ZOOM, z - SCAN_ZOOM_STEP))}
                        disabled={scanZoom <= SCAN_MIN_ZOOM}
                        aria-label="Zoom out"
                        className="-my-[var(--space-xs)] py-[var(--space-xs)] disabled:opacity-40"
                        style={{ color: theme.headerBg }}
                      >
                        <ZoomOut size={16} strokeWidth={2} />
                      </button>
                      <span className="w-9 text-center text-caption font-semibold" style={{ color: theme.headerBg }}>
                        {Math.round(scanZoom * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setScanZoom((z) => Math.min(SCAN_MAX_ZOOM, z + SCAN_ZOOM_STEP))}
                        disabled={scanZoom >= SCAN_MAX_ZOOM}
                        aria-label="Zoom in"
                        className="-my-[var(--space-xs)] py-[var(--space-xs)] disabled:opacity-40"
                        style={{ color: theme.headerBg }}
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
                      style={{ color: theme.headerBg }}
                    >
                      Open
                    </Link>
                  )}
                </div>
              </div>

              <div className={`relative h-[480px] bg-background-alt ${scanZoom > 1 ? "overflow-auto" : "overflow-hidden"}`}>
                {scanLoading && previewUrl && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Spinner size="md" />
                  </div>
                )}
                {previewUrl ? (
                  isPdf ? (
                    <iframe
                      src={previewUrl}
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
                    <p className="text-body-sm text-text-secondary">No scanned copy available for this invoice.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showConfidenceInfo && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/45 p-[var(--space-lg)]"
          onClick={() => setShowConfidenceInfo(false)}
        >
          <div className="w-full max-w-md cursor-auto rounded-2xl bg-white p-[var(--space-lg)]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-h3 font-extrabold text-text-primary">Confidence Score</h2>
            <p className="mt-[var(--space-sm)] text-body-sm text-text-secondary">
              This score reflects how confident Scantrix is in the data extracted from your scanned invoice — things
              like the vendor, amounts, and invoice number.
            </p>
            <p className="mt-[var(--space-md)] rounded-md bg-background-alt p-[var(--space-sm)] text-center text-caption text-text-secondary">
              Higher confidence scores indicate greater accuracy of extracted invoice data and require less manual
              review. If a field looks off, you can always correct it below before posting.
            </p>
            <button
              type="button"
              onClick={() => setShowConfidenceInfo(false)}
              className="mt-[var(--space-md)] h-12 w-full rounded-md bg-primary font-bold text-white"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
