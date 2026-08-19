"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpLeft, Check, ChevronRight, Clock, RefreshCw, Upload } from "lucide-react";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { StatRow } from "@/components/invoices/StatRow";
import { TopVendorsCard } from "@/components/invoices/TopVendorsCard";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices, rejectInvoice, scanInvoice } from "@/store/invoice/invoiceApi";
import {
  connectQuickBooks,
  getMyQBConnections,
  getQuickBooksStatus,
  syncQuickBooksAccounts,
  syncQuickBooksTaxCodes,
  syncQuickBooksVendors,
} from "@/store/quickBooks/quickBooksApi";
import { showToast } from "@/lib/dialogManager";
import { getInvoiceAmount, getInvoiceFailureReason, getInvoiceStatus } from "@/lib/invoiceDisplay";
import { requestExpandTransition } from "@/lib/pageTransition";
import { setSelectedInvoice } from "@/store/invoice/invoiceSlice";
import type { InvoiceRecord } from "@/store/invoice/invoiceSlice";

// This session's own last successful fetch, not a backend-tracked sync
// cadence (no such field exists yet) — "just now" right after mount/Sync
// now, ticking forward via the caller's re-render.
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
// "Sync now" pulls the QB connection status plus vendors/GL accounts/tax
// codes in one shot — throttled so a user mashing the button doesn't fan out
// 4 requests every click.
const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

// Real dropzone matching the landing page's ScanVisual card style (dashed
// border, centered icon-in-circle, generous padding) — visual language
// only, none of that component's fake demo content. Both drag-and-drop and
// click-to-browse funnel into the same `onFilesSelected`, which the parent
// wires to the exact scanInvoice upload path the old small button used —
// no parallel upload logic, just called once per file.
function InvoiceDropzone({
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
    // Required so the browser treats this element as a valid drop target.
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
      className={`flex min-h-[280px] flex-1 cursor-pointer flex-col items-center justify-center gap-[var(--space-sm)] rounded-lg border-2 border-dashed p-[var(--space-xl)] text-center transition-colors ${
        dragActive ? "border-primary-500 bg-primary-100" : "border-primary-300 bg-background-soft hover:border-primary-500 hover:bg-primary-100"
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
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 shadow-sm">
        {uploading ? <Spinner size="md" /> : <Upload size={26} strokeWidth={2} className="text-primary" />}
      </span>
      <p className="text-body font-bold text-trust-navy">
        {uploading ? progressLabel || "Uploading…" : "Drag & drop your invoices"}
      </p>
      <p className="text-body-sm text-text-secondary">
        {uploading ? "This won't take long." : `or click to browse — PDF or photo, up to ${MAX_UPLOAD_FILES} at a time`}
      </p>
    </div>
  );
}

// Independent of INVOICE_STATUS_THEME (auto/manual/pending/processing/failed)
// — this table collapses auto+manual into one "Posted" pill, matching the
// simpler three-bucket view this specific table is going for. Posted reuses
// the same dark-green primary tokens as the rest of the app's auto-posted
// styling per the earlier color-unification pass.
const RECENT_STATUS_STYLE = {
  posted: { label: "Posted", dot: "bg-primary-600", text: "text-primary-700", bg: "bg-primary-50" },
  // Matches INVOICE_STATUS_THEME.pending / InvoiceDetailContent's pending
  // theme (trust-navy) instead of warning-yellow, for cross-page consistency.
  pending: { label: "Pending", dot: "bg-trust-navy", text: "text-trust-navy", bg: "bg-trust-navy/10" },
  processing: { label: "Processing", dot: "bg-warning", text: "text-warning", bg: "bg-warning/10" },
  failed: { label: "Failed", dot: "bg-error", text: "text-error", bg: "bg-error/10" },
} as const;

function recentStatusKey(status: ReturnType<typeof getInvoiceStatus>): keyof typeof RECENT_STATUS_STYLE {
  if (status === "auto" || status === "manual") return "posted";
  if (status === "processing") return "processing";
  if (status === "failed") return "failed";
  return "pending";
}

// "Yesterday" instead of "1 day ago" — matches how people actually talk
// about a date that recent, unlike the plain "N ago" used for sync times.
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

function RecentInvoiceRow({
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
  const vendorName = invoice.extractedData?.vendorName || invoice.file?.originalName?.replace(/\.pdf$/i, "") || "Unknown Vendor";
  const reference = invoice.extractedData?.invoiceNumber ? `#${invoice.extractedData.invoiceNumber}` : null;
  const failureReason = statusKey === "failed" ? getInvoiceFailureReason(invoice) : "";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`flex cursor-pointer flex-col gap-[var(--space-sm)] rounded-lg border border-border px-[var(--space-sm)] py-[var(--space-sm)] lg:grid lg:grid-cols-[auto_auto_2fr_1fr_0.9fr_0.9fr_20px] lg:items-center lg:gap-[var(--space-sm)] lg:border-0 ${
        selected ? "bg-primary-50" : "hover:bg-background-alt"
      }`}
    >
      {/* lg:contents keeps these as direct grid items (same column order as
          before) on desktop, while grouping them into one flex row below lg
          so the row reads as a card: avatar + vendor info together. */}
      <div className="flex items-center gap-[var(--space-sm)] lg:contents">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${vendorName}`}
          className="h-4 w-4 shrink-0 accent-primary"
        />
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-caption font-bold ${style.bg} ${style.text}`}>
          {vendorName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-text-primary">{vendorName}</p>
          {failureReason ? (
            <p className="truncate text-caption text-error">{failureReason}</p>
          ) : reference ? (
            <p className="truncate text-caption text-text-secondary">{reference}</p>
          ) : null}
        </div>
      </div>
      {/* Same lg:contents trick — received/status/amount/chevron stay in
          their original column order at lg, but wrap into a second,
          space-between line below lg instead of squeezing into a 7-col grid. */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] lg:contents">
        <span className="text-caption text-text-secondary">{receivedLabel(invoice.createdAt)}</span>
        <span className={`inline-flex w-fit items-center gap-[6px] rounded-pill px-[var(--space-sm)] py-[2px] text-caption font-bold ${style.bg} ${style.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
        <span className="text-right font-bold text-text-primary">{getInvoiceAmount(invoice)}</span>
        <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
      </div>
    </div>
  );
}

export function DashboardContent() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState<number | null>(null);
  const [connectingQB, setConnectingQB] = useState(false);
  const [syncingQB, setSyncingQB] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // Deliberately separate from lastSyncedAt above — that one gets touched by
  // routine invoice refreshes (on mount, and every 3s while an invoice is
  // processing), which would keep resetting a shared cooldown and leave
  // "Sync now" permanently disabled. This one only ever moves on an actual
  // manual Sync now click.
  const [lastQBSyncAt, setLastQBSyncAt] = useState<number | null>(null);
  const [, setSyncLabelTick] = useState(0);
  const [recentTab, setRecentTab] = useState<"all" | "auto" | "pending" | "failed">("all");
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
  const { connected, statusLoading, qbConnectionId, disconnectReason } = useAppSelector((state) => state.quickBooks);
  const needsReconnect = disconnectReason === "reconnect_required";

  // Connected to at least one company but haven't picked one yet via the
  // top-bar switcher — qbConnectionId only ever starts/goes blank while
  // `connected` is true when there are 2+ companies to choose from (see
  // quickBooksSlice.ts's getMyQBConnections.fulfilled) — a single connection
  // is always auto-selected. So this can't be confused with "not connected
  // to QuickBooks at all", which is handled by the banner above instead.
  const needsEntitySelection = connected && !qbConnectionId;

  // "Last synced" is relative time, so re-render once a minute to keep it
  // from reading "just now" long after it's stopped being true.
  useEffect(() => {
    const interval = setInterval(() => setSyncLabelTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const accessToken: string | undefined = user?.data?.accessToken;

  const syncInvoices = useCallback(async () => {
    await dispatch(getInvoices());
    setLastSyncedAt(Date.now());
  }, [dispatch]);

  const syncCooldownActive = lastQBSyncAt !== null && Date.now() - lastQBSyncAt < SYNC_COOLDOWN_MS;

  const handleSyncNow = async () => {
    if (!accessToken || !qbConnectionId || syncingQB) return;
    if (syncCooldownActive) {
      const secondsLeft = Math.ceil((SYNC_COOLDOWN_MS - (Date.now() - (lastQBSyncAt ?? 0))) / 1000);
      showToast(`Please wait ${secondsLeft}s before syncing again.`, "error");
      return;
    }
    setSyncingQB(true);
    try {
      const [, vendorsResult, accountsResult, taxCodesResult] = await Promise.all([
        dispatch(getQuickBooksStatus({ accessToken, qbConnectionId })),
        dispatch(syncQuickBooksVendors({ accessToken })),
        dispatch(syncQuickBooksAccounts({ accessToken })),
        dispatch(syncQuickBooksTaxCodes({ accessToken })),
      ]);
      const vendorsOk = syncQuickBooksVendors.fulfilled.match(vendorsResult);
      const accountsOk = syncQuickBooksAccounts.fulfilled.match(accountsResult);
      const taxCodesOk = syncQuickBooksTaxCodes.fulfilled.match(taxCodesResult);
      const okCount = [vendorsOk, accountsOk, taxCodesOk].filter(Boolean).length;

      await syncInvoices();

      if (okCount === 3) {
        const vendorCount = vendorsOk ? vendorsResult.payload?.data?.count : undefined;
        const accountCount = accountsOk ? accountsResult.payload?.data?.count : undefined;
        const taxCodeCount = taxCodesOk ? taxCodesResult.payload?.data?.count : undefined;
        showToast(
          `Synced ${vendorCount ?? 0} vendor(s), ${accountCount ?? 0} GL account(s), and ${taxCodeCount ?? 0} tax code(s) from QuickBooks.`,
          "success",
        );
      } else if (okCount > 0) {
        showToast("Synced, but part of it failed. Try again in a moment.", "error");
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
      // A revoked/invalid refresh token still occupies this connection's
      // slot, so a plain (no qbConnectionId) connect would 402 on the slot
      // check — re-auth the SAME connection instead of starting a new one.
      const result = await dispatch(
        connectQuickBooks(needsReconnect && qbConnectionId ? { accessToken, qbConnectionId } : { accessToken }),
      );
      if (connectQuickBooks.fulfilled.match(result)) {
        const authUrl = result.payload?.data?.authUrl;
        if (authUrl) {
          window.location.href = authUrl;
          return;
        }
        showToast("Could not start QuickBooks connection. Please try again.", "error");
      } else {
        showToast(typeof result.payload === "string" ? result.payload : "Could not start QuickBooks connection.", "error");
      }
    } finally {
      setConnectingQB(false);
    }
  };

  // Only needs to run once, on mount — this populates the org switcher list,
  // not per-entity business data.
  useEffect(() => {
    if (accessToken) dispatch(getMyQBConnections({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // getInvoices() is scoped by whatever qbConnectionId is currently in the
  // store (via the X-QB-Id header — see lib/api.ts's interceptor), and the
  // backend 400s outright if that header is missing. Right after a fresh
  // login that id is deliberately blank (the login-time purge resets it so a
  // previous session's value can't leak in) until getMyQBConnections above
  // populates the real one, so this is guarded on qbConnectionId being set
  // rather than firing unconditionally on mount. Depending on qbConnectionId
  // itself (not just mount) is also what makes switching companies in the
  // top bar refresh this page's invoices instead of leaving the previous
  // entity's data on screen until a manual reload.
  useEffect(() => {
    if (!qbConnectionId) return;
    syncInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId]);

  // Mirrors DashboardScreen's 3s poll while any invoice is still processing.
  useEffect(() => {
    const hasProcessing = invoices.some((invoice) => invoice.postedStatus === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(syncInvoices, 3000);
    return () => clearInterval(interval);
  }, [invoices, syncInvoices]);

  const pendingText =
    pendingInvoices.length === 1 ? "1 invoice needs your review" : `${pendingInvoices.length} invoices need your review`;

  // Which array feeds the table depends on the tab — "Pending"/"Failed" show
  // the actual pending/failed invoices (not just whichever of the 5 most
  // recent overall happen to match), since those tabs would otherwise often
  // render empty.
  const recentTabInvoices = useMemo(() => {
    const source =
      recentTab === "auto"
        ? autoPostedInvoices
        : recentTab === "pending"
          ? pendingInvoices
          : recentTab === "failed"
            ? failedInvoices
            : invoices;
    return source.slice(0, 5);
  }, [recentTab, invoices, autoPostedInvoices, pendingInvoices, failedInvoices]);

  // Pre-seed selectedInvoice before navigating, same as InvoiceListContent's
  // handleOpenInvoice — the detail page renders whatever's already in
  // selectedInvoice while its own getInvoiceDetails fetch is in flight, so
  // skipping this would flash whatever invoice was last viewed instead.
  // Pending invoices go straight to the editable review screen (matching
  // PendingInvoicesContent's handleOpenInvoice) since a pending invoice has
  // no posted data yet worth showing read-only.
  const handleOpenInvoice = (invoice: InvoiceRecord) => {
    dispatch(setSelectedInvoice(invoice));
    const suffix = invoice.postedStatus === "pending" ? "/review" : "";
    router.push(`/invoices/${invoice._id}${suffix}`);
  };

  // Kicks off the "Recent card grows into the full Invoices page" animation
  // (see ExpandTransitionOverlay, mounted in AppShell) — the rect must be
  // captured now, synchronously, since this element unmounts as soon as the
  // navigation below commits.
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

  // Blank instead of a blended total when currencies differ — adding raw
  // numbers across currencies would be a meaningless (and misleading) sum.
  const selectedTotalLabel = useMemo(() => {
    if (selectedInvoices.length === 0) return "";
    const currencies = new Set(selectedInvoices.map((invoice) => invoice.extractedData?.currency || ""));
    if (currencies.size > 1) return "mixed currencies";
    const total = selectedInvoices.reduce((sum, invoice) => sum + (invoice.extractedData?.totalAmount || 0), 0);
    return `${[...currencies][0]} ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
  }, [selectedInvoices]);

  // Only "Reject" is real here — bulk "Approve & post" would need a resolved
  // vendor + reviewed line items per invoice (that's the whole reason /review
  // exists), and there's no "assign to a person" concept anywhere in this
  // app yet. Rather than fake either, they're left out of this bar for now.
  const handleBulkReject = async () => {
    if (selectedInvoices.length === 0 || rejectingBulk) return;
    setRejectingBulk(true);
    try {
      let failures = 0;
      for (const invoice of selectedInvoices) {
        const result = await dispatch(rejectInvoice({ invoiceId: invoice._id }));
        if (!rejectInvoice.fulfilled.match(result)) {
          failures += 1;
          const payload = result.payload;
          const vendorName = invoice.extractedData?.vendorName || "Invoice";
          showToast(`${vendorName}: ${typeof payload === "string" ? payload : "Could not reject"}`, "error");
        }
      }
      const succeeded = selectedInvoices.length - failures;
      if (succeeded > 0) {
        showToast(`Rejected ${succeeded} invoice${succeeded === 1 ? "" : "s"}.`, "success");
      }
      setSelectedIds(new Set());
    } finally {
      setRejectingBulk(false);
    }
  };

  // Weekly scan volume — bucketed by when each invoice was actually scanned
  // (createdAt), not its own invoice date, since this chart is about upload
  // activity. Rolling 7-day windows ending today rather than calendar weeks,
  // so "this week" always means "the last 7 days" regardless of what day it is.
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

  // Single upload path for every entry point (click-to-browse, drag-and-drop) —
  // both call this, neither duplicates it. Keeps the FormData/scanInvoice call
  // exactly as it was before the dropzone existed (see scanInvoice's own
  // comment on the RN-FormData bug this fixed once already). All selected
  // files go up in ONE request, matching the backend's upload.array("files",
  // 10) — the backend processes each file independently (one bad file only
  // fails itself, not the rest of the batch), so a fulfilled result here can
  // still carry a partial `data.failed` list, handled below.
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!qbConnectionId) {
        showToast("Please connect a QuickBooks account before scanning invoices.", "error");
        return;
      }

      if (files.length > MAX_UPLOAD_FILES) {
        showToast(`You can upload up to ${MAX_UPLOAD_FILES} invoices at a time. Please select ${MAX_UPLOAD_FILES} or fewer.`, "error");
        return;
      }

      setUploading(true);
      setUploadCount(files.length);
      try {
        const result = await dispatch(scanInvoice({ files, qbId: qbConnectionId }));
        if (!scanInvoice.fulfilled.match(result)) {
          const payload = result.payload;
          showToast(
            typeof payload === "string" ? payload : "Invoice upload failed.",
            "error",
          );
        } else {
          // The backend processes each file independently — one bad file
          // (corrupt upload, S3 hiccup) doesn't cost the rest of the batch,
          // so a 201 here can still carry a partial list of failures.
          const failed = (result.payload as { data?: { failed?: { fileName?: string; message?: string }[] } })?.data
            ?.failed;
          if (failed && failed.length > 0) {
            showToast(
              `${failed.length} of ${files.length} file(s) failed: ${failed
                .map((f) => f.fileName || "unknown file")
                .join(", ")}. The rest were uploaded.`,
              "error",
            );
          }
        }
        // Sync unconditionally, not just when at least one upload "succeeded".
        // The scan pipeline is not transactional — a request can error on the
        // client (timeout, 401 with no retry for writes) after the backend has
        // already created the invoice. If we only refreshed on success, that
        // hidden invoice would sit invisible and the user would re-scan the
        // same file, producing a duplicate bill in QuickBooks. Refreshing
        // lets it surface (typically as pending) to be reviewed/posted once.
        setTimeout(syncInvoices, 1500);
      } finally {
        setUploading(false);
        setUploadCount(null);
      }
    },
    [dispatch, qbConnectionId, syncInvoices],
  );

  // Nothing on this page means anything until a company is picked — rather
  // than show a dashboard full of zeroes (or worse, a failed invoice fetch
  // for whatever happened to be selected), the entire page collapses to
  // just this prompt. Everything reappears the instant qbConnectionId is
  // set, since that's the only thing gating this branch.
  if (needsEntitySelection) {
    return (
      <div className="relative mx-auto max-w-6xl p-[var(--space-lg)]">
        {/* Points back at the top-bar switcher itself, not at this text —
            positioned near the top-left of the page content, right under
            the header, rather than under the message below. */}
        <ArrowUpLeft size={40} strokeWidth={2.25} className="absolute left-[var(--space-xs)] top-0 animate-bounce text-primary" />
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
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-[var(--space-lg)] p-[var(--space-lg)] lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
    <div className="flex flex-col gap-[var(--space-md)]">

      {!statusLoading && !connected && (
        <button
          type="button"
          onClick={handleConnectQuickBooks}
          disabled={connectingQB}
          className="flex items-center justify-between rounded-lg border border-[#F5D7A4] bg-[#FFF7E6] p-[var(--space-md)] text-left disabled:opacity-60"
        >
          <div>
            <p className="font-bold text-[#9A6700]">{needsReconnect ? "QuickBooks Needs Reconnecting" : "QuickBooks Not Connected"}</p>
            <p className="mt-[var(--space-xs)] text-caption text-text-secondary">
              {connectingQB
                ? "Connecting…"
                : needsReconnect
                  ? "QuickBooks revoked access to this connection. Reconnect to resume syncing and posting."
                  : "Connect QuickBooks to sync vendors and post invoices."}
            </p>
          </div>
          <ArrowRight size={20} strokeWidth={2} className="shrink-0 text-primary" />
        </button>
      )}

      <Link
        href="/invoices/pending"
        className="flex items-center gap-[var(--space-md)] rounded-lg bg-primary-900 p-[var(--space-lg)] text-white shadow-md"
      >
        {/* Icon fill and count badge use dark text on their bright teal
            backgrounds for the same contrast reason as the sidebar's active
            pill — see DESIGN_ASSUMPTIONS.md D2.3. */}
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary-500">
          <Clock size={22} strokeWidth={2} className="text-text-primary" />
        </span>
        <div className="min-w-0">
          <p className="font-bold">Pending Review</p>
          <p className="mt-[var(--space-xs)] text-body-sm font-medium text-primary-200">{pendingText}</p>
        </div>
        <div className="ml-auto flex items-center gap-[var(--space-sm)]">
          <span className="flex h-7 min-w-7 items-center justify-center rounded-pill bg-primary-400 px-[var(--space-xs)] text-body-sm font-bold text-primary-900">
            {pendingInvoices.length}
          </span>
          <ArrowRight size={18} strokeWidth={2} className="shrink-0 text-white" />
        </div>
      </Link>

      {/*
        Upload gets the wider, first-read column — it's the primary action on
        this page. The three totals move into a narrower scoreboard beside it,
        restacked vertically since they no longer need full card width to be
        legible as a single number + label each.
      */}
      <div className="flex flex-col gap-[var(--space-md)] md:flex-row">
        <InvoiceDropzone
          uploading={uploading}
          progressLabel={uploadCount ? `Uploading ${uploadCount} invoice${uploadCount === 1 ? "" : "s"}…` : undefined}
          onFilesSelected={uploadFiles}
        />
        <div className="flex flex-col gap-[var(--space-sm)] md:w-64">
          <StatRow count={autoPostedInvoices.length} label="Auto-posted" href="/invoices?type=auto" theme="auto" />
          <StatRow
            count={manualPostedInvoices.length}
            label="Manually Posted"
            href="/invoices?type=manual"
            theme="manual"
          />
          <StatRow count={failedInvoices.length} label="Failed" href="/invoices?type=failed" theme="failed" />
        </div>
      </div>

      <div ref={recentCardRef} className="mt-[var(--space-md)] rounded-lg border border-border bg-white p-[var(--space-lg)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
          <div className="flex items-center gap-[var(--space-sm)]">
            <h2 className="text-h3 font-bold text-text-primary">Recent</h2>
            {invoiceLoading && recentTabInvoices.length > 0 && <Spinner size="sm" />}
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
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-border text-text-secondary hover:bg-background-alt"
                  }`}
                >
                  {tab === "all" ? "All" : tab === "auto" ? "Auto-posted" : tab === "pending" ? "Pending" : "Failed"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleViewAllInvoices}
              className="flex items-center gap-[var(--space-xs)] rounded-pill bg-primary-50 px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-semibold text-primary-700 hover:bg-primary-100"
            >
              View all
              <ArrowRight size={14} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="mt-[var(--space-md)] flex flex-wrap items-center justify-between gap-[var(--space-sm)] rounded-lg bg-primary-50 px-[var(--space-md)] py-[var(--space-sm)]">
            <div className="flex items-center gap-[var(--space-sm)]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-700 text-white">
                <Check size={14} strokeWidth={3} />
              </span>
              <span className="text-body-sm font-semibold text-primary-800">
                {selectedIds.size} selected{selectedTotalLabel ? ` · ${selectedTotalLabel}` : ""}
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

        {/* Column labels only make sense for the desktop grid rows below —
            the mobile card layout has its own inline labeling per row, so
            this header is hidden below lg rather than squeezing 7 columns
            into a phone width. */}
        <div className="mt-[var(--space-md)] hidden grid-cols-[auto_auto_2fr_1fr_0.9fr_0.9fr_20px] gap-[var(--space-sm)] border-b border-border px-[var(--space-sm)] pb-[var(--space-sm)] text-caption font-bold uppercase tracking-wide text-text-secondary lg:grid">
          <span />
          <span />
          <span>Vendor / Reference</span>
          <span>Received</span>
          <span>Status</span>
          <span className="text-right">Amount</span>
          <span />
        </div>

        {/* lg:contents restores the exact flat sibling structure (and
            therefore spacing) the desktop layout had before the header above
            gained a mobile-hidden state — this wrapper only carries real
            margin/gap below lg, where it substitutes for the now-hidden
            header's spacing and adds breathing room between stacked cards. */}
        <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)] lg:mt-0 lg:contents">
          {invoiceLoading && recentTabInvoices.length === 0 && <SkeletonListRows count={3} className="mt-[var(--space-sm)]" />}

          {/* Show the error whenever the fetch failed, regardless of whether
              recentTabInvoices happens to be non-empty — a failed fetch means
              whatever's in state is not this session's confirmed data, and
              masking that behind stale data is exactly how the cross-account
              invoice leak went unnoticed. Don't render the (possibly stale)
              list alongside it. */}
          {!invoiceLoading && invoiceError && (
            <ErrorState
              message={typeof invoiceError === "string" ? invoiceError : "Couldn't load recent invoices."}
              onRetry={syncInvoices}
            />
          )}

          {!invoiceLoading && !invoiceError && recentTabInvoices.length === 0 && (
            <div className="flex flex-col items-center py-[var(--space-lg)] text-center">
              <p className="font-bold text-text-primary">No invoices here</p>
              <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
                {recentTab === "all"
                  ? "Scanned and posted invoices will appear here."
                  : recentTab === "auto"
                    ? "No auto-posted invoices right now."
                    : `No ${recentTab} invoices right now.`}
              </p>
            </div>
          )}

          {!invoiceError &&
            recentTabInvoices.map((invoice) => (
              <RecentInvoiceRow
                key={invoice._id}
                invoice={invoice}
                selected={selectedIds.has(invoice._id)}
                onToggleSelect={() => toggleSelected(invoice._id)}
                onOpen={() => handleOpenInvoice(invoice)}
              />
            ))}
        </div>
      </div>
    </div>

    <aside className="flex flex-col gap-[var(--space-md)]">
      {connected && (
        <Card>
          <div className="flex items-center gap-[var(--space-sm)]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#2ca01c] text-[11px] font-bold text-white">
              qb
            </span>
            <h4 className="text-body font-bold text-text-primary">QuickBooks</h4>
            <span className="ml-auto inline-flex shrink-0 items-center gap-[var(--space-xs)] rounded-pill bg-primary-100 px-[var(--space-sm)] py-[2px] text-caption font-bold text-primary-700">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
              Synced
            </span>
          </div>
          <p className="mt-[var(--space-sm)] text-caption text-text-secondary">
            {lastSyncedAt ? `Last synced ${timeAgo(lastSyncedAt)}` : "Not synced yet this session."}
          </p>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncingQB || syncCooldownActive}
            title={syncCooldownActive ? "You can sync again in a couple of minutes." : undefined}
            className="mt-[var(--space-md)] inline-flex items-center gap-[var(--space-xs)] rounded-pill border border-border px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-bold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={14} strokeWidth={2.25} className={syncingQB ? "animate-spin" : ""} />
            {syncingQB ? "Syncing…" : "Sync now"}
          </button>
        </Card>
      )}

      <TopVendorsCard invoices={invoices} />

      {weeklyScans.total > 0 && (
        <div className="rounded-lg border border-border bg-white p-[var(--space-lg)]">
          <div className="flex items-end justify-between gap-[var(--space-sm)]">
            <div>
              <h4 className="text-body font-bold text-text-primary">Weekly scans</h4>
              <p className="text-caption text-text-secondary">Invoices scanned, last {WEEKLY_SCAN_WEEKS} weeks</p>
            </div>
            <span className="text-h3 font-bold text-text-primary">{weeklyScans.total}</span>
          </div>
          <div className="mt-[var(--space-md)] flex h-20 items-end gap-[6px]">
            {weeklyScans.buckets.map((bucket, i) => {
              const isRecent = i >= weeklyScans.buckets.length - 2;
              const pct = bucket.count > 0 ? Math.max(Math.round((bucket.count / weeklyScans.max) * 100), 10) : 0;
              return (
                // Full-height light track so every week reads as its own bar
                // slot even at a count of 0, not just whichever weeks happen
                // to have scans — otherwise a mostly-empty history looks like
                // one bar floating with nothing beside it.
                <div
                  key={i}
                  className="flex h-full flex-1 items-end rounded-t-sm bg-primary-50"
                  title={`${bucket.count} scanned`}
                >
                  <div
                    className={`w-full rounded-t-sm ${isRecent ? "bg-primary" : "bg-primary-200"}`}
                    style={{ height: `${pct}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-[var(--space-xs)] flex gap-[6px]">
            {weeklyScans.buckets.map((bucket, i) => (
              <span key={i} className="flex-1 text-center text-[10px] text-text-secondary">
                {bucket.weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
    </div>
  );
}
