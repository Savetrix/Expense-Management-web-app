"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getInvoiceDetails,
  postInvoiceToQuickBooks,
  rejectInvoice,
} from "@/store/invoice/invoiceApi";
import {
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
} from "@/store/quickBooks/quickBooksApi";
import { setSelectedVendor } from "@/store/vendor/vendorSlice";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { translateInvoiceReason } from "@/lib/invoiceDisplay";
import { getReviewTheme } from "@/lib/invoiceReviewTheme";
import { taxCodeId as getTaxCodeId, taxCodeName as getTaxCodeName } from "@/lib/quickbooks/taxCode";
import { Spinner } from "@/components/ui/Spinner";

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

function EditableField({
  label,
  value,
  onChange,
  fieldBorder,
  valueColor,
  error,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fieldBorder: string;
  valueColor: string;
  error?: string;
  multiline?: boolean;
}) {
  const borderStyle = { borderColor: error ? "var(--color-error)" : fieldBorder, borderWidth: error ? 2 : 1 };
  return (
    <div className="mb-[var(--space-sm)] rounded-lg bg-white p-[var(--space-sm)] shadow-sm" style={borderStyle}>
      <label className={`mb-[var(--space-xs)] block text-caption font-medium ${error ? "font-bold text-error" : "text-[#9A9A9A]"}`}>
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${label}`}
          rows={3}
          className="w-full resize-none text-body font-bold focus:outline-none"
          style={{ color: valueColor }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${label}`}
          className="w-full text-body font-bold focus:outline-none"
          style={{ color: valueColor }}
        />
      )}
      {error && <p className="mt-[var(--space-xs)] text-caption font-semibold text-error">{error}</p>}
    </div>
  );
}

export function InvoiceReviewContent({ invoiceId }: { invoiceId: string }) {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const invoiceObject = useAppSelector((state) => state.invoice.selectedInvoice);
  const rejecting = useAppSelector((state) => state.invoice.rejecting);
  const posting = useAppSelector((state) => state.invoice.posting);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const glAccountsLoading = useAppSelector((state) => state.quickBooks.accountsLoading);
  const glAccountsError = useAppSelector((state) => state.quickBooks.accountsError);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const taxCodesLoading = useAppSelector((state) => state.quickBooks.taxCodesLoading);
  const taxCodesError = useAppSelector((state) => state.quickBooks.taxCodesError);
  const createdVendor = useAppSelector((state) => state.vendor.createdVendor);
  const selectedVendor = useAppSelector((state) => state.vendor.selectedVendor);
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);

  useEffect(() => {
    dispatch(getInvoiceDetails(invoiceId));
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
  const confidenceScore = Number.isFinite(Number(invoiceObject?.confidenceScore))
    ? Math.max(0, Math.min(100, Number(invoiceObject?.confidenceScore)))
    : 0;
  const [frozenConfidenceScore] = useState(confidenceScore);
  const statusHistory = invoiceObject?.statusHistory || [];
  const latestStatus = statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : null;
  const postingReason = latestStatus?.reason || "";
  const vendorResolutionRequired = postingReason.toLowerCase().includes("vendor");
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

  const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const vendor = vendors.find((v) => v._id === event.target.value);
    if (!vendor) return;
    updateField("vendor", vendor.displayName);
    dispatch(
      setSelectedVendor({
        _id: vendor._id,
        displayName: vendor.displayName,
        qbVendorId: vendor.qbVendorId,
        email: null,
        phone: null,
        address: null,
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
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
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
    const confirmed = await confirmDialog({
      title: "Post to QuickBooks?",
      message: "Please verify all details are correct before confirming.",
      confirmLabel: "Post invoice",
    });
    if (confirmed) submitToQuickBooks();
  };

  if (!invoiceObject) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-soft">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: theme.screenBg }}>
      <div
        className="flex h-[58px] shrink-0 items-center justify-between px-[var(--space-md)]"
        style={{ backgroundColor: theme.headerBg }}
      >
        <button type="button" onClick={() => router.back()} aria-label="Back" className="text-white">
          <ChevronLeft size={26} strokeWidth={2.25} />
        </button>
        <h1 className="text-body font-extrabold tracking-wide text-white">Invoice Review</h1>
        {previewUrl ? (
          <Link
            href={`/invoices/preview?url=${encodeURIComponent(previewUrl)}&mimeType=${encodeURIComponent(previewMimeType)}`}
            className="rounded-md bg-white/20 px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-bold text-white"
          >
            View Invoice
          </Link>
        ) : (
          <span className="w-6" />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-[var(--space-md)] pb-[var(--space-lg)] pt-[var(--space-lg)]">
        {/* Confidence card */}
        <div className="relative mb-[var(--space-lg)] rounded-2xl p-[var(--space-lg)] text-center" style={{ backgroundColor: theme.cardBg }}>
          <p className="text-5xl font-extrabold" style={{ color: theme.primaryText }}>
            {Math.round(frozenConfidenceScore)}%
          </p>
          <button
            type="button"
            onClick={() => setShowConfidenceInfo(true)}
            className="absolute right-[var(--space-md)] top-[var(--space-md)] flex h-8 w-8 items-center justify-center rounded-full bg-white/75 font-extrabold"
            style={{ color: theme.primaryText }}
          >
            ?
          </button>
          <p className="mt-[var(--space-xs)] font-bold" style={{ color: theme.secondaryText }}>
            {theme.statusText}
          </p>
          <div className="mx-auto mt-[var(--space-md)] h-4 w-[92%] overflow-hidden rounded-md" style={{ backgroundColor: theme.progressTrack }}>
            <div
              className="h-full rounded-md"
              style={{ width: `${Math.max(8, Math.min(frozenConfidenceScore, 100))}%`, backgroundColor: theme.progressFill }}
            />
          </div>

          {reasonDisplay && (
            <div className="mt-[var(--space-md)] rounded-lg bg-white p-[var(--space-md)] text-left">
              <p className="font-bold text-text-primary">Why this requires review</p>
              <p className="mt-[var(--space-xs)] text-body-sm text-error">{reasonDisplay.message}</p>
              {reasonDisplay.isTranslated && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowTechnicalReason((v) => !v)}
                    className="mt-[var(--space-xs)] text-caption font-semibold text-text-secondary underline"
                  >
                    {showTechnicalReason ? "Hide technical details" : "Show technical details"}
                  </button>
                  {showTechnicalReason && (
                    <p className="mt-[var(--space-xs)] break-words text-caption text-text-secondary">
                      {reasonDisplay.raw}
                    </p>
                  )}
                </>
              )}
              {vendorResolutionRequired &&
                (vendorIsResolved ? (
                  <div className="mt-[var(--space-sm)] flex items-center justify-between rounded-md border border-[#B6E8D3] bg-[#EAF7F1] px-[var(--space-sm)] py-[var(--space-xs)]">
                    <span className="flex items-center gap-[var(--space-xs)] text-body-sm font-semibold text-[#15805D]">
                      <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" />
                      Vendor resolved: {selectedVendor?.displayName || createdVendor?.name}
                    </span>
                    <Link href={`/invoices/${invoiceId}/vendor`} className="text-body-sm font-bold text-primary">
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

        {/* Vendor field */}
        <div
          className="mb-[var(--space-sm)] rounded-lg bg-white p-[var(--space-sm)] shadow-sm"
          style={{ borderColor: fieldErrors.vendor ? "var(--color-error)" : theme.fieldBorder, borderWidth: fieldErrors.vendor ? 2 : 1 }}
        >
          <label className={`mb-[var(--space-xs)] block text-caption font-medium ${fieldErrors.vendor ? "font-bold text-error" : "text-[#9A9A9A]"}`}>
            Vendor
          </label>
          <select
            value={selectedVendor?._id || ""}
            onChange={handleVendorChange}
            className="w-full bg-transparent text-body font-bold focus:outline-none"
            style={{ color: theme.valueText }}
          >
            <option value="" disabled>
              {invoice.vendor || "Select Vendor"}
            </option>
            {vendors.map((vendor) => (
              <option key={vendor._id} value={vendor._id}>
                {vendor.displayName}
              </option>
            ))}
          </select>
          {fieldErrors.vendor && <p className="mt-[var(--space-xs)] text-caption font-semibold text-error">{fieldErrors.vendor}</p>}
        </div>

        <EditableField label="Invoice Number" value={invoice.invoiceNumber} onChange={(v) => updateField("invoiceNumber", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} error={fieldErrors.invoiceNumber} />
        <EditableField label="Invoice Date" value={invoice.invoiceDate} onChange={(v) => updateField("invoiceDate", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} />
        <EditableField label="Due Date" value={invoice.dueDate} onChange={(v) => updateField("dueDate", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} />
        <EditableField label="Amount" value={invoice.totalAfterTax} onChange={(v) => updateField("totalAfterTax", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} error={fieldErrors.totalAfterTax} />

        {/* Currency field */}
        <div
          className="mb-[var(--space-sm)] rounded-lg bg-white p-[var(--space-sm)] shadow-sm"
          style={{ borderColor: fieldErrors.currency ? "var(--color-error)" : theme.fieldBorder, borderWidth: fieldErrors.currency ? 2 : 1 }}
        >
          <label className={`mb-[var(--space-xs)] block text-caption font-medium ${fieldErrors.currency ? "font-bold text-error" : "text-[#9A9A9A]"}`}>
            Currency
          </label>
          <select
            value={invoice.currency}
            onChange={(e) => updateField("currency", e.target.value)}
            className="w-full bg-transparent text-body font-bold focus:outline-none"
            style={{ color: theme.valueText }}
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
          {fieldErrors.currency && <p className="mt-[var(--space-xs)] text-caption font-semibold text-error">{fieldErrors.currency}</p>}
        </div>

        {/* GL Account field */}
        <div
          className="mb-[var(--space-sm)] rounded-lg bg-white p-[var(--space-sm)] shadow-sm"
          style={{ borderColor: fieldErrors.glAccountId ? "var(--color-error)" : theme.fieldBorder, borderWidth: fieldErrors.glAccountId ? 2 : 1 }}
        >
          <label className={`mb-[var(--space-xs)] block text-caption font-medium ${fieldErrors.glAccountId ? "font-bold text-error" : "text-[#9A9A9A]"}`}>
            GL Code / Category
          </label>
          <select
            value={invoice.glAccountId}
            onChange={handleGlAccountChange}
            className="w-full bg-transparent text-body font-bold focus:outline-none"
            style={{ color: theme.valueText }}
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
          </select>
          {fieldErrors.glAccountId && <p className="mt-[var(--space-xs)] text-caption font-semibold text-error">{fieldErrors.glAccountId}</p>}
          {glAccountsErrorDisplay && (
            <div className="mt-[var(--space-xs)]">
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
        </div>

        {/* Tax Code field (optional) */}
        <div
          className="mb-[var(--space-sm)] rounded-lg bg-white p-[var(--space-sm)] shadow-sm"
          style={{ borderColor: theme.fieldBorder, borderWidth: 1 }}
        >
          <label className="mb-[var(--space-xs)] block text-caption font-medium text-[#9A9A9A]">Tax Code</label>
          <select
            value={invoice.taxCodeId}
            onChange={(e) => updateField("taxCodeId", e.target.value)}
            className="w-full bg-transparent text-body font-bold focus:outline-none"
            style={{ color: theme.valueText }}
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
            <div className="mt-[var(--space-xs)]">
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
        </div>

        <EditableField label="Amount Before Tax" value={invoice.amountBeforeTax} onChange={(v) => updateField("amountBeforeTax", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} error={fieldErrors.amountBeforeTax} />
        <EditableField label="Tax Amount" value={invoice.taxAmount} onChange={(v) => updateField("taxAmount", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} error={fieldErrors.taxAmount} />
        <EditableField label="Vendor Address" value={invoice.vendorAddress} onChange={(v) => updateField("vendorAddress", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} multiline />
        <EditableField label="Vendor Bank Details" value={invoice.vendorBankDetails} onChange={(v) => updateField("vendorBankDetails", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} multiline />
        <EditableField label="Item Descriptions" value={invoice.itemDescriptionsText} onChange={(v) => updateField("itemDescriptionsText", v)} fieldBorder={theme.fieldBorder} valueColor={theme.valueText} multiline />
      </div>
      </div>

      {/* Footer actions */}
      <div className="mx-auto flex w-full max-w-2xl shrink-0 gap-[var(--space-sm)] border-t border-border px-[var(--space-md)] py-[var(--space-md)]">
        <button
          type="button"
          onClick={handleReject}
          disabled={isRejectDisabled}
          className="h-12 flex-1 rounded-lg border-2 border-error bg-[#FFF0F0] font-extrabold text-error disabled:opacity-45"
        >
          {rejecting ? "Rejecting…" : "Reject"}
        </button>
        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={isPostDisabled}
          className="h-12 flex-[3] rounded-lg font-extrabold text-white disabled:opacity-45"
          style={{ backgroundColor: theme.buttonBg }}
        >
          {posting ? "Posting…" : theme.actionText}
        </button>
      </div>

      {showConfidenceInfo && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/45 p-[var(--space-lg)]"
          onClick={() => setShowConfidenceInfo(false)}
        >
          <div className="w-full max-w-md cursor-auto rounded-2xl bg-white p-[var(--space-lg)]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-h3 font-extrabold text-text-primary">Confidence Score Calculation</h2>
            <p className="mt-[var(--space-sm)] text-body-sm text-text-secondary">
              Every invoice starts with a confidence score of <strong>100%</strong>.
            </p>
            <div className="my-[var(--space-md)] h-px bg-border" />
            {[
              ["Vendor Name", "Missing, similar or new vendor detected"],
              ["Currency", "Currency could not be extracted"],
              ["Invoice Number", "Missing or duplicate invoice number"],
              ["Amount Before Tax", "Amount before tax is missing"],
              ["Tax Amount", "Tax amount is missing"],
            ].map(([field, reason]) => (
              <div key={field} className="mb-[var(--space-sm)]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text-primary">{field}</span>
                  <span className="font-extrabold text-error">-10</span>
                </div>
                <p className="text-caption text-text-secondary">{reason}</p>
              </div>
            ))}
            <p className="mt-[var(--space-md)] rounded-md bg-background-alt p-[var(--space-sm)] text-center text-caption text-text-secondary">
              Higher confidence scores indicate greater accuracy of extracted invoice data and require less manual
              review.
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
