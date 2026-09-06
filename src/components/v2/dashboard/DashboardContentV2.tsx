"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpLeft,
  Check,
  ChevronRight,
  Clock,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { TopVendorsCardV2 } from "@/components/v2/invoices/TopVendorsCardV2";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  getInvoices,
  rejectInvoice,
  scanInvoice,
} from "@/store/invoice/invoiceApi";
import {
  connectQuickBooks,
  getMyQBConnections,
  getQuickBooksStatus,
  syncQuickBooksAccounts,
  syncQuickBooksTaxCodes,
  syncQuickBooksVendors,
} from "@/store/quickBooks/quickBooksApi";
import { showToast } from "@/lib/dialogManager";
import {
  getInvoiceAmount,
  getInvoiceFailureReason,
  getInvoiceStatus,
} from "@/lib/invoiceDisplay";
import { requestExpandTransition } from "@/lib/pageTransition";
import { setSelectedInvoice } from "@/store/invoice/invoiceSlice";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

/**
 * v2 redesign of DashboardContent (see .claude/skills/redesign-v2). All
 * data fetching, thunks, selectors, and event handlers below are copied
 * verbatim from the original — only markup/layout/classes changed:
 *  - Pending Review moved from the main column into the aside, as a compact
 *    teal banner, to match the reference layout.
 *  - Auto-posted/Manually Posted/Failed become plain colored-number rows in
 *    one card next to the dropzone, instead of three individually-tinted
 *    cards.
 *  - Top vendors uses the multi-tone TopVendorsCardV2 bar palette.
 */

function timeAgo(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const MAX_UPLOAD_FILES = 10;
const WEEKLY_SCAN_WEEKS = 5;
const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

function InvoiceDropzoneV2({
  uploading,
  progressLabel,
  onFilesSelected,
}: {
  uploading: boolean;
  progressLabel?: string;
  onFilesSelected: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const openPicker = () => {
    if (!uploading) fileInputRef.current?.click();
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) onFilesSelected(files);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) onFilesSelected(files);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload invoices — drag and drop or click to browse, up to 20 at a time"
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex min-h-[250px] flex-1 cursor-pointer flex-col items-center justify-center gap-[var(--space-sm)] rounded-lg border-2 border-dashed p-[var(--space-xl)] text-center shadow-sm transition-colors ${
        dragActive
          ? "border-accent bg-accent-bg"
          : "border-border-strong hover:border-accent hover:bg-accent-bg"
      } ${uploading ? "pointer-events-none opacity-70" : ""}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        className="hidden"
        disabled={uploading}
        onChange={handleChange}
      />
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent shadow-sm">
        {uploading ? (
          <Spinner size="md" />
        ) : (
          <Upload size={26} strokeWidth={2.25} className="text-white" />
        )}
      </span>
      <p className="text-body font-bold text-text-primary">
        {uploading
          ? progressLabel || "Uploading…"
          : "Drag & drop your invoices"}
      </p>
      <p className="text-body-sm text-text-secondary">
        {uploading
          ? "This won't take long."
          : `or click to browse — PDF or photo, up to ${MAX_UPLOAD_FILES} at a time`}
      </p>
    </div>
  );
}

// Plain colored-number row (no tinted background) — matches the reference
// design's stats card. Same status color tokens the app uses everywhere
// else (status-success/warning/danger), just applied to the number only.
function StatRowV2({
  count,
  label,
  href,
  colorClass,
  last,
}: {
  count: number;
  label: string;
  href: string;
  colorClass: string;
  last?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-[var(--space-sm)] py-[var(--space-sm)] ${
        last ? "" : "border-b border-border"
      }`}
    >
      <span className="text-body-sm font-medium text-text-secondary">
        {label}
      </span>
      <span className={`text-h2 font-bold ${colorClass}`}>{count}</span>
    </Link>
  );
}

const RECENT_STATUS_STYLE = {
  posted: {
    label: "Posted",
    dot: "bg-status-success-text",
    text: "text-status-success-text",
    bg: "bg-status-success-bg",
  },
  pending: {
    label: "Pending",
    dot: "bg-status-warning-text",
    text: "text-status-warning-text",
    bg: "bg-status-warning-bg",
  },
  processing: {
    label: "Processing",
    dot: "bg-status-info-text",
    text: "text-status-info-text",
    bg: "bg-status-info-bg",
  },
  failed: {
    label: "Failed",
    dot: "bg-status-danger-text",
    text: "text-status-danger-text",
    bg: "bg-status-danger-bg",
  },
} as const;

function recentStatusKey(
  status: ReturnType<typeof getInvoiceStatus>,
): keyof typeof RECENT_STATUS_STYLE {
  if (status === "auto" || status === "manual") return "posted";
  if (status === "processing") return "processing";
  if (status === "failed") return "failed";
  return "pending";
}

function receivedLabel(dateStr?: string): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  const hours = Math.floor((Date.now() - date.getTime()) / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function RecentInvoiceRowV2({
  invoice,
  selected,
  onToggleSelect,
  onOpen,
}: {
  invoice: InvoiceRecord;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const statusKey = recentStatusKey(getInvoiceStatus(invoice.postedStatus));
  const style = RECENT_STATUS_STYLE[statusKey];
  const vendorName =
    invoice.extractedData?.vendorName ||
    invoice.file?.originalName?.replace(/\.pdf$/i, "") ||
    "Unknown Vendor";
  const reference = invoice.extractedData?.invoiceNumber
    ? `#${invoice.extractedData.invoiceNumber}`
    : null;
  const failureReason =
    statusKey === "failed" ? getInvoiceFailureReason(invoice) : "";

  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`group cursor-pointer border-b border-border last:border-b-0 ${
        selected ? "bg-accent-bg" : "hover:bg-background-alt"
      }`}
    >
      <td className="w-10 px-[var(--space-xs)] py-[var(--space-sm)] align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${vendorName}`}
          className="h-4 w-4 accent-primary"
        />
      </td>
      <td className="w-12 px-[var(--space-xs)] py-[var(--space-sm)] align-middle">
        <span className="flex h-8 w-8 items-center justify-center rounded-md text-caption font-bold text-text-secondary">
          {vendorName.slice(0, 2).toUpperCase()}
        </span>
      </td>
      <td className="min-w-0 px-[var(--space-sm)] py-[var(--space-sm)] align-middle">
        <p className="max-w-[280px] truncate font-bold text-text-primary">
          {vendorName}
        </p>
        {failureReason ? (
          <p className="max-w-[280px] truncate text-caption text-error">
            {failureReason}
          </p>
        ) : reference ? (
          <p className="truncate text-caption text-text-secondary">
            {reference}
          </p>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-text-secondary align-middle">
        {receivedLabel(invoice.createdAt)}
      </td>
      <td className="px-[var(--space-sm)] py-[var(--space-sm)] align-middle">
        <span
          className={`inline-flex w-fit items-center gap-[6px] rounded-pill px-[var(--space-sm)] py-[2px] text-caption font-bold ${style.bg} ${style.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </td>
      <td className="whitespace-nowrap px-[var(--space-sm)] py-[var(--space-sm)] text-right font-bold text-text-primary align-middle">
        {getInvoiceAmount(invoice)}
      </td>
      <td className="w-8 px-[var(--space-xs)] py-[var(--space-sm)] align-middle">
        <ChevronRight
          size={18}
          strokeWidth={2}
          className="text-text-secondary"
        />
      </td>
    </tr>
  );
}

export function DashboardContentV2() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState<number | null>(null);
  const [connectingQB, setConnectingQB] = useState(false);
  const [syncingQB, setSyncingQB] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastQBSyncAt, setLastQBSyncAt] = useState<number | null>(null);
  const [, setSyncLabelTick] = useState(0);
  const [recentTab, setRecentTab] = useState<
    "all" | "auto" | "pending" | "failed"
  >("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectingBulk, setRejectingBulk] = useState(false);
  const recentCardRef = useRef<HTMLDivElement>(null);

  const user = useAppSelector((state) => state.auth.user);
  const {
    invoices,
    autoPostedInvoices,
    manualPostedInvoices,
    pendingInvoices,
    failedInvoices,
    loading: invoiceLoading,
    error: invoiceError,
  } = useAppSelector((state) => state.invoice);
  const { connected, statusLoading, qbConnectionId, disconnectReason } =
    useAppSelector((state) => state.quickBooks);
  const needsReconnect = disconnectReason === "reconnect_required";

  const needsEntitySelection = connected && !qbConnectionId;

  useEffect(() => {
    const interval = setInterval(() => setSyncLabelTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const accessToken: string | undefined = user?.data?.accessToken;

  const syncInvoices = useCallback(async () => {
    await dispatch(getInvoices());
    setLastSyncedAt(Date.now());
  }, [dispatch]);

  const syncCooldownActive =
    lastQBSyncAt !== null && Date.now() - lastQBSyncAt < SYNC_COOLDOWN_MS;

  const handleSyncNow = async () => {
    if (!accessToken || !qbConnectionId || syncingQB) return;
    if (syncCooldownActive) {
      const secondsLeft = Math.ceil(
        (SYNC_COOLDOWN_MS - (Date.now() - (lastQBSyncAt ?? 0))) / 1000,
      );
      showToast(`Please wait ${secondsLeft}s before syncing again.`, "error");
      return;
    }
    setSyncingQB(true);
    try {
      const [, vendorsResult, accountsResult, taxCodesResult] =
        await Promise.all([
          dispatch(getQuickBooksStatus({ accessToken, qbConnectionId })),
          dispatch(syncQuickBooksVendors({ accessToken })),
          dispatch(syncQuickBooksAccounts({ accessToken })),
          dispatch(syncQuickBooksTaxCodes({ accessToken })),
        ]);
      const vendorsOk = syncQuickBooksVendors.fulfilled.match(vendorsResult);
      const accountsOk = syncQuickBooksAccounts.fulfilled.match(accountsResult);
      const taxCodesOk = syncQuickBooksTaxCodes.fulfilled.match(taxCodesResult);
      const okCount = [vendorsOk, accountsOk, taxCodesOk].filter(
        Boolean,
      ).length;

      await syncInvoices();

      if (okCount === 3) {
        const vendorCount = vendorsOk
          ? vendorsResult.payload?.data?.count
          : undefined;
        const accountCount = accountsOk
          ? accountsResult.payload?.data?.count
          : undefined;
        const taxCodeCount = taxCodesOk
          ? taxCodesResult.payload?.data?.count
          : undefined;
        showToast(
          `Synced ${vendorCount ?? 0} vendor(s), ${accountCount ?? 0} GL account(s), and ${taxCodeCount ?? 0} tax code(s) from QuickBooks.`,
          "success",
        );
      } else if (okCount > 0) {
        showToast(
          "Synced, but part of it failed. Try again in a moment.",
          "error",
        );
      } else {
        showToast("Could not sync with QuickBooks. Please try again.", "error");
      }
    } finally {
      setLastQBSyncAt(Date.now());
      setSyncingQB(false);
    }
  };

  const handleConnectQuickBooks = async () => {
    if (!accessToken || connectingQB) return;
    setConnectingQB(true);
    try {
      const result = await dispatch(
        connectQuickBooks(
          needsReconnect && qbConnectionId
            ? { accessToken, qbConnectionId }
            : { accessToken },
        ),
      );
      if (connectQuickBooks.fulfilled.match(result)) {
        const authUrl = result.payload?.data?.authUrl;
        if (authUrl) {
          window.location.href = authUrl;
          return;
        }
        showToast(
          "Could not start QuickBooks connection. Please try again.",
          "error",
        );
      } else {
        showToast(
          typeof result.payload === "string"
            ? result.payload
            : "Could not start QuickBooks connection.",
          "error",
        );
      }
    } finally {
      setConnectingQB(false);
    }
  };

  useEffect(() => {
    if (accessToken) dispatch(getMyQBConnections({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!qbConnectionId) return;
    syncInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId]);

  useEffect(() => {
    const hasProcessing = invoices.some(
      (invoice) => invoice.postedStatus === "processing",
    );
    if (!hasProcessing) return;
    const interval = setInterval(syncInvoices, 3000);
    return () => clearInterval(interval);
  }, [invoices, syncInvoices]);

  const pendingText =
    pendingInvoices.length === 1
      ? "1 invoice needs your review"
      : `${pendingInvoices.length} invoices need your review`;

  const recentTabInvoices = useMemo(() => {
    const source =
      recentTab === "auto"
        ? autoPostedInvoices
        : recentTab === "pending"
          ? pendingInvoices
          : recentTab === "failed"
            ? failedInvoices
            : invoices;
    return source.slice(0, 10);
  }, [
    recentTab,
    invoices,
    autoPostedInvoices,
    pendingInvoices,
    failedInvoices,
  ]);

  const handleOpenInvoice = (invoice: InvoiceRecord) => {
    dispatch(setSelectedInvoice(invoice));
    const suffix = invoice.postedStatus === "pending" ? "/review" : "";
    router.push(`/invoices/${invoice._id}${suffix}`);
  };

  const handleViewAllInvoices = () => {
    if (recentCardRef.current) requestExpandTransition(recentCardRef.current);
    router.push("/invoices");
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedInvoices = useMemo(
    () => invoices.filter((invoice) => selectedIds.has(invoice._id)),
    [invoices, selectedIds],
  );

  const selectedTotalLabel = useMemo(() => {
    if (selectedInvoices.length === 0) return "";
    const currencies = new Set(
      selectedInvoices.map((invoice) => invoice.extractedData?.currency || ""),
    );
    if (currencies.size > 1) return "mixed currencies";
    const total = selectedInvoices.reduce(
      (sum, invoice) => sum + (invoice.extractedData?.totalAmount || 0),
      0,
    );
    return `${[...currencies][0]} ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
  }, [selectedInvoices]);

  const handleBulkReject = async () => {
    if (selectedInvoices.length === 0 || rejectingBulk) return;
    setRejectingBulk(true);
    try {
      let failures = 0;
      for (const invoice of selectedInvoices) {
        const result = await dispatch(
          rejectInvoice({ invoiceId: invoice._id }),
        );
        if (!rejectInvoice.fulfilled.match(result)) {
          failures += 1;
          const payload = result.payload;
          const vendorName = invoice.extractedData?.vendorName || "Invoice";
          showToast(
            `${vendorName}: ${typeof payload === "string" ? payload : "Could not reject"}`,
            "error",
          );
        }
      }
      const succeeded = selectedInvoices.length - failures;
      if (succeeded > 0) {
        showToast(
          `Rejected ${succeeded} invoice${succeeded === 1 ? "" : "s"}.`,
          "success",
        );
      }
      setSelectedIds(new Set());
    } finally {
      setRejectingBulk(false);
    }
  };

  const weeklyScans = useMemo(() => {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const buckets = Array.from({ length: WEEKLY_SCAN_WEEKS }, (_, i) => ({
      count: 0,
      weekStart: new Date(now - (WEEKLY_SCAN_WEEKS - i) * msPerWeek),
    }));

    for (const invoice of invoices) {
      if (!invoice.createdAt) continue;
      const scannedAt = new Date(invoice.createdAt).getTime();
      if (Number.isNaN(scannedAt)) continue;

      const age = now - scannedAt;
      if (age < 0 || age >= WEEKLY_SCAN_WEEKS * msPerWeek) continue;

      const bucketFromNewest = Math.floor(age / msPerWeek);
      buckets[WEEKLY_SCAN_WEEKS - 1 - bucketFromNewest].count += 1;
    }

    return {
      buckets,
      total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
      max: Math.max(...buckets.map((bucket) => bucket.count), 1),
    };
  }, [invoices]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!qbConnectionId) {
        showToast(
          "Please connect a QuickBooks account before scanning invoices.",
          "error",
        );
        return;
      }

      if (files.length > MAX_UPLOAD_FILES) {
        showToast(
          `You can upload up to ${MAX_UPLOAD_FILES} invoices at a time. Please select ${MAX_UPLOAD_FILES} or fewer.`,
          "error",
        );
        return;
      }

      setUploading(true);
      setUploadCount(files.length);
      try {
        const result = await dispatch(
          scanInvoice({ files, qbId: qbConnectionId }),
        );
        if (!scanInvoice.fulfilled.match(result)) {
          const payload = result.payload;
          showToast(
            typeof payload === "string" ? payload : "Invoice upload failed.",
            "error",
          );
        } else {
          const failed = (
            result.payload as {
              data?: { failed?: { fileName?: string; message?: string }[] };
            }
          )?.data?.failed;
          if (failed && failed.length > 0) {
            showToast(
              `${failed.length} of ${files.length} file(s) failed: ${failed
                .map((f) => f.fileName || "unknown file")
                .join(", ")}. The rest were uploaded.`,
              "error",
            );
          }
        }
        setTimeout(syncInvoices, 1500);
      } finally {
        setUploading(false);
        setUploadCount(null);
      }
    },
    [dispatch, qbConnectionId, syncInvoices],
  );

  if (needsEntitySelection) {
    return (
      <div className="relative mx-auto max-w-6xl p-[var(--space-lg)]">
        <ArrowUpLeft
          size={40}
          strokeWidth={2.25}
          className="absolute left-[var(--space-xs)] top-0 animate-bounce text-accent"
        />
        <div className="mx-auto flex max-w-md flex-col items-center py-[var(--space-xl)] text-center">
          <p className="text-h2 font-bold text-trust-navy">Select a company</p>
          <p className="mt-[var(--space-sm)] text-body-sm text-text-secondary">
            Select a company from the switcher up top to see its dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full grid-cols-1 gap-[var(--space-lg)] p-[var(--space-lg)] sm:grid-cols-2 lg:grid-cols-6 lg:items-start">
      <div className="flex min-w-0 flex-col gap-[var(--space-md)] sm:col-span-2 lg:col-span-4">
        {!statusLoading && !connected && (
          <button
            type="button"
            onClick={handleConnectQuickBooks}
            disabled={connectingQB}
            className="flex items-center justify-between rounded-lg border border-status-warning-border bg-status-warning-bg p-[var(--space-md)] text-left disabled:opacity-60"
          >
            <div>
              <p className="font-bold text-status-warning-text">
                {needsReconnect
                  ? "QuickBooks Needs Reconnecting"
                  : "QuickBooks Not Connected"}
              </p>
              <p className="mt-[var(--space-xs)] text-caption text-text-secondary">
                {connectingQB
                  ? "Connecting…"
                  : needsReconnect
                    ? "QuickBooks revoked access to this connection. Reconnect to resume syncing and posting."
                    : "Connect QuickBooks to sync vendors and post invoices."}
              </p>
            </div>
            <ArrowRight
              size={20}
              strokeWidth={2}
              className="shrink-0 text-status-warning-text"
            />
          </button>
        )}

        {/* Upload + stats row — reference design puts these side by side as
            two same-height white cards, instead of the original's dropzone
            with a plain stats column beside it. */}
        <div className="flex flex-col  gap-[var(--space-sm)] md:flex-row">
          <InvoiceDropzoneV2
            uploading={uploading}
            progressLabel={
              uploadCount
                ? `Uploading ${uploadCount} invoice${uploadCount === 1 ? "" : "s"}…`
                : undefined
            }
            onFilesSelected={uploadFiles}
          />
          <div className="flex flex-col justify-center rounded-lg border border-border  p-[var(--space-lg)] shadow-sm md:w-64">
            <StatRowV2
              count={autoPostedInvoices.length}
              label="Auto-posted"
              href="/invoices?type=auto"
              colorClass="text-status-success-text"
            />
            <StatRowV2
              count={manualPostedInvoices.length}
              label="Manually Posted"
              href="/invoices?type=manual"
              colorClass="text-status-warning-text"
            />
            <StatRowV2
              count={failedInvoices.length}
              label="Failed"
              href="/invoices?type=failed"
              colorClass="text-status-danger-text"
              last
            />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-[var(--space-md)] sm:col-span-2 lg:col-span-2">
        <Link
          href="/invoices?type=pending"
          className="flex items-center gap-[var(--space-sm)] rounded-lg bg-nav-bg p-[var(--space-md)] text-white shadow-md"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent">
            <Clock size={22} strokeWidth={2} className="text-accent-ink" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-bold uppercase tracking-wide text-nav-text">
              Pending Review
            </p>
            <p className="mt-[var(--space-xs)] text-body-sm font-medium text-white">
              {pendingText}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-[var(--space-sm)]">
            <span className="flex h-7 min-w-7 items-center justify-center rounded-pill bg-nav-hover px-[var(--space-xs)] text-body-sm font-bold text-white">
              {pendingInvoices.length}
            </span>
            <ArrowRight
              size={18}
              strokeWidth={2}
              className="shrink-0 text-white"
            />
          </div>
        </Link>
        {connected && (
          <Card>
            <div className="flex items-center gap-[var(--space-sm)]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md  text-[11px] font-bold border border-border text-text-primary">
                qb
              </span>
              <h4 className="text-body font-bold text-text-primary">
                QuickBooks
              </h4>
              <span className="ml-auto inline-flex shrink-0 items-center gap-[var(--space-xs)] rounded-pill bg-status-success-bg px-[var(--space-sm)] py-[2px] text-caption font-bold text-status-success-text">
                <span className="h-1.5 w-1.5 rounded-full bg-status-success-text" />
                Synced
              </span>
            </div>
            <p className="mt-[var(--space-sm)] text-caption text-text-secondary text-end">
              {lastSyncedAt
                ? `Last synced ${timeAgo(lastSyncedAt)}`
                : "Not synced yet this session."}
            </p>
            <div className="mt-[var(--space-md)] flex w-full justify-end">
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={syncingQB || syncCooldownActive}
                title={
                  syncCooldownActive
                    ? "You can sync again in a couple of minutes."
                    : undefined
                }
                className="inline-flex h-9 min-w-[120px] w-[50%] items-center justify-center gap-[var(--space-xs)] rounded-pill border border-border px-[var(--space-lg)] text-body-sm font-bold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  size={14}
                  strokeWidth={2.25}
                  className={syncingQB ? "animate-spin" : ""}
                />
                {syncingQB ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </Card>
        )}
      </div>
      
      <div className="flex min-w-0 flex-col gap-[var(--space-md)] sm:col-span-2 lg:col-span-4">


        <div
          ref={recentCardRef}
          className="flex rounded-lg border border-border p-[var(--space-lg)] shadow-sm lg:h-[500px] flex-col overflow-auto"
        >
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
            <div className="flex items-center gap-[var(--space-sm)]">
              <h2 className="text-h3 font-bold text-text-primary">Recent</h2>
              {invoiceLoading && recentTabInvoices.length > 0 && (
                <Spinner size="sm" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
              <div className="flex gap-[var(--space-xs)]">
                {(["all", "auto", "pending", "failed"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setRecentTab(tab)}
                    className={`rounded-pill border px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-semibold ${
                      recentTab === tab
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-border text-text-secondary hover:bg-background-alt"
                    }`}
                  >
                    {tab === "all"
                      ? "All"
                      : tab === "auto"
                        ? "Auto-posted"
                        : tab === "pending"
                          ? "Pending"
                          : "Failed"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleViewAllInvoices}
                className="flex items-center gap-[var(--space-xs)] rounded-pill bg-accent-bg px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-semibold text-accent-text-on-bg hover:opacity-80"
              >
                View all
                <ArrowRight size={14} strokeWidth={2.25} />
              </button>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="mt-[var(--space-md)] flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-lg bg-accent-bg px-[var(--space-md)] py-[var(--space-sm)]">
              <div className="flex items-center gap-[var(--space-sm)]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink">
                  <Check size={14} strokeWidth={3} />
                </span>
                <span className="text-body-sm font-semibold text-accent-text-on-bg">
                  {selectedIds.size} selected
                  {selectedTotalLabel ? ` · ${selectedTotalLabel}` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={handleBulkReject}
                disabled={rejectingBulk}
                className="rounded-pill px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-bold text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {rejectingBulk ? "Rejecting…" : "Reject"}
              </button>
            </div>
          )}

          <div className="mt-[var(--space-md)] min-h-0 overflow-auto lg:flex-1">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="sticky top-0 z-10 border-b border-border bg-background text-caption font-bold uppercase tracking-wide text-text-secondary">
                <tr>
                  <th scope="col" className="w-10 px-[var(--space-xs)] pb-[var(--space-sm)]" />
                  <th scope="col" className="w-12 px-[var(--space-xs)] pb-[var(--space-sm)]" />
                  <th scope="col" className="px-[var(--space-sm)] pb-[var(--space-sm)]">
                    Vendor / Reference
                  </th>
                  <th scope="col" className="px-[var(--space-sm)] pb-[var(--space-sm)]">
                    Received
                  </th>
                  <th scope="col" className="px-[var(--space-sm)] pb-[var(--space-sm)]">
                    Status
                  </th>
                  <th scope="col" className="px-[var(--space-sm)] pb-[var(--space-sm)] text-right">
                    Amount
                  </th>
                  <th scope="col" className="w-8 px-[var(--space-xs)] pb-[var(--space-sm)]" />
                </tr>
              </thead>
              <tbody>
                {invoiceLoading && recentTabInvoices.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <SkeletonListRows count={3} className="mt-[var(--space-sm)]" />
                    </td>
                  </tr>
                )}

                {!invoiceLoading && invoiceError && (
                  <tr>
                    <td colSpan={7}>
                      <ErrorState
                        message={
                          typeof invoiceError === "string"
                            ? invoiceError
                            : "Couldn't load recent invoices."
                        }
                        onRetry={syncInvoices}
                      />
                    </td>
                  </tr>
                )}

                {!invoiceLoading &&
                  !invoiceError &&
                  recentTabInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="flex flex-col items-center py-[var(--space-lg)] text-center">
                          <p className="font-bold text-text-primary">
                            No invoices here
                          </p>
                          <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
                            {recentTab === "all"
                              ? "Scanned and posted invoices will appear here."
                              : recentTab === "auto"
                                ? "No auto-posted invoices right now."
                                : `No ${recentTab} invoices right now.`}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}

                {!invoiceError &&
                  recentTabInvoices.map((invoice) => (
                    <RecentInvoiceRowV2
                      key={invoice._id}
                      invoice={invoice}
                      selected={selectedIds.has(invoice._id)}
                      onToggleSelect={() => toggleSelected(invoice._id)}
                      onOpen={() => handleOpenInvoice(invoice)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-[var(--space-md)] sm:col-span-2 lg:col-span-2">
        <TopVendorsCardV2 invoices={invoices} />


        {weeklyScans.total > 0 && (
          <div className="rounded-lg border border-border p-[var(--space-lg)] shadow-sm">
            <div className="flex items-end justify-between gap-[var(--space-sm)]">
              <div>
                <h4 className="text-body font-bold text-text-primary">
                  Weekly scans
                </h4>
                <p className="text-caption text-text-secondary">
                  Invoices scanned, last {WEEKLY_SCAN_WEEKS} weeks
                </p>
              </div>
              <span className="text-h3 font-bold text-text-primary">
                {weeklyScans.total}
              </span>
            </div>
            <div className="mt-[var(--space-md)] flex h-20 items-end gap-[6px]">
              {weeklyScans.buckets.map((bucket, i) => {
                const isRecent = i >= weeklyScans.buckets.length - 2;
                const pct =
                  bucket.count > 0
                    ? Math.max(
                        Math.round((bucket.count / weeklyScans.max) * 100),
                        10,
                      )
                    : 0;
                return (
                  <div
                    key={i}
                    className="flex h-full flex-1 items-end rounded-t-sm "
                    title={`${bucket.count} scanned`}
                  >
                    <div
                      className={`w-full rounded-t-sm ${isRecent ? "bg-accent" : "bg-status-info-border"}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-[var(--space-xs)] flex gap-[6px]">
              {weeklyScans.buckets.map((bucket, i) => (
                <span
                  key={i}
                  className="flex-1 text-center text-[10px] text-text-secondary"
                >
                  {bucket.weekStart.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
