"use client";

import { AlertTriangle, ArrowLeftRight, CheckCircle2, ExternalLink, EyeOff, FileQuestion, Landmark, Paperclip, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { AddGlAccountModalV2 } from "@/components/v2/glTaxCode/AddGlAccountModalV2";
import { CreatableCombobox, DataTable, RoleInfoBanner, SearchInput, SelectDropdown, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { AddVendorModalV2 } from "@/components/v2/vendors/AddVendorModalV2";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { taxCodeId, taxCodeLabel } from "@/lib/quickbooks/taxCode";

import { ConfidenceLabel } from "@/components/v2/suggestions/ConfidenceLabel";

import { codingFor, isSuggestedField, isSureLine, picksFor, surePatch, type Lookups } from "./coding";
import { formatAmount } from "./format";
import { findStrongSuggestions, type StrongSuggestion } from "./matching";
import { LINE_COLUMN_WIDTH, SuggestedMatches } from "./SuggestedMatches";
import { STATUS_LABEL } from "./TransactionModal";
import type { LedgerAccountDto, NamedAccountDto } from "@/store/bankFeeds/bankFeedsApi";
import { suggestedVendorName } from "@/lib/suggestions/similar";

import { bankLineGlChoices, lineCurrency, lineLedgerId, newVendorPatch, vendorFormDefaults } from "./glList";
import { openAttachment } from "./paperworkClient";
import { RequestPaperworkModal } from "./RequestPaperworkModal";
import { useAppSelector } from "@/store/hooks";

import { dateBounds, inDates, inTab, localToday, PERIOD_LABEL, TAB_LABEL, tabOf, type DatePeriod, type ListTab } from "./listView";
import type { BankAccount, BankTransaction, BankTxnStatus, InvoiceCandidate } from "./types";

// The bank lines, coded on the row: vendor, GL account and tax code are
// dropdowns in the line itself (pick one or add one), pre-filled when the payee
// was seen before, and Post / Match / Transfer / Exclude sit at the end of the
// line. The detail dialog (click the description) holds everything else.

interface TransactionsTabProps {
  txns: BankTransaction[];
  providerName: string;
  onImportFile: () => void;
  /** Absent for roles that can't connect a bank. */
  onConnect?: () => void;
  /** Opens the detail dialog; `focus` = which part to show first ("payBill": Accounts Payable was picked, so pick the bill it pays). */
  onOpen: (id: string, focus?: "match" | "transfer" | "payBill") => void;
  onUpdate: (id: string, patch: Partial<BankTransaction>) => void;
  invoices: InvoiceCandidate[];
  /** Bills that can't be matched any more (see closedBills). */
  closedBills?: ReadonlySet<string>;
  onBulkUpdate: (ids: string[], patch: Partial<BankTransaction>) => void;
  /** Posts lines: saves each as ready and sends it to QuickBooks/Xero when it can. */
  onPost: (items: { txn: BankTransaction; patch: Partial<BankTransaction> }[]) => void;
  /** Accepts suggested matches; the parent also sends them when it can. */
  onAcceptMatches: (picked: StrongSuggestion[]) => void;
  /** "Not this" on a line ScanTrix found already entered in QuickBooks/Xero. */
  onUnlinkFound?: (id: string) => void;
  lookups: Lookups;
  /** First load from the server still running. */
  loading?: boolean;
  /** The company's chart in QuickBooks/Xero, or why it isn't available. */
  ledger: { accounts: LedgerAccountDto[]; reason: string | null; error: string | null };
  /** Sends decided lines to QuickBooks/Xero. Absent for roles that can't post. */
  onSend?: (ids: string[]) => void;
  sendingIds: Set<string>;
  /** Connected bank accounts and imported-file names, with what they map to: which account (and currency) a line belongs to. */
  bankAccounts: BankAccount[];
  named: NamedAccountDto[];
  /** The company's home currency, the last fallback for a line's currency. */
  homeCurrency: string | null;
  /** Reads the chart of accounts again (an account someone expects is missing). */
  onRefreshAccounts?: () => void;
  /** A paperwork request was sent (the page refreshes its count). */
  onPaperworkRequested?: () => void;
}

/** Decided lines that go to QuickBooks/Xero. */
const SENDABLE: BankTxnStatus[] = ["ready", "matched", "transfer"];
export const isUnsent = (t: BankTransaction) => SENDABLE.includes(t.status) && t.postingStatus !== "posted";

/** Why sending isn't possible right now, in the user's words (null = it is). */
export function ledgerBlock(reason: string | null, error: string | null, providerName: string): string | null {
  if (!reason) return null;
  if (reason === "posting_not_configured") return `Sending lines to ${providerName} isn't switched on on this server yet. Post still saves each line as ready.`;
  if (reason === "scope") return `${providerName} hasn't allowed ScanTrix to post bank entries yet. Reconnect ${providerName} once (Integrations) to allow it.`;
  if (reason === "reconnect") return error || `Reconnect ${providerName} (Integrations) to send lines.`;
  if (reason === "permission") return error || `Your role can't send lines to ${providerName}.`;
  return error || `ScanTrix couldn't reach ${providerName} just now.`;
}

const DATE_CLASS =
  "h-8 rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40";
const ROW_BTN =
  "inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50";

/** The coding a Post would save: what the row shows, suggested or chosen. */
function postPatch(t: BankTransaction, lookups: Lookups): Partial<BankTransaction> | null {
  const c = codingFor(t);
  if (!c.glAccountId) return null;
  const vendorName = c.vendorId ? lookups.vendorById.get(c.vendorId)?.displayName : undefined;
  return { status: "ready", vendorId: c.vendorId, categoryId: c.glAccountId, taxCodeId: c.taxCodeId, payee: c.payee ?? vendorName ?? t.payee };
}

export function TransactionsTab({
  txns,
  providerName,
  onImportFile,
  onConnect,
  onOpen,
  onUpdate,
  invoices,
  closedBills,
  onBulkUpdate,
  onPost,
  onAcceptMatches,
  onUnlinkFound,
  lookups,
  loading = false,
  ledger,
  onSend,
  sendingIds,
  bankAccounts,
  named,
  homeCurrency,
  onRefreshAccounts,
  onPaperworkRequested,
}: TransactionsTabProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ListTab>("review");
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  // QuickBooks-style periods, or Custom from–to dates; applies to every tab.
  const [period, setPeriod] = useState<DatePeriod>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ txnId: string; kind: "vendor" | "gl"; name: string } | null>(null);
  const [requesting, setRequesting] = useState<BankTransaction[] | null>(null);
  const qbConnectionId = useAppSelector((st) => st.quickBooks.qbConnectionId);

  const vendorOptions = useMemo(() => lookups.vendors.map((v) => ({ id: v._id, label: v.displayName })), [lookups.vendors]);
  // The other side of the line's entry: the full chart of accounts without
  // Bank-type accounts or the line's own account (glList.ts).
  const ledgerNameById = useMemo(() => new Map(ledger.accounts.map((a) => [a.id, a.name])), [ledger.accounts]);
  const glChoicesFor = (t: BankTransaction) => bankLineGlChoices({ chart: ledger.accounts, backendGl: lookups.glAccounts, lineLedgerId: lineLedgerId(t, bankAccounts, named), moneyIn: t.amount > 0 });
  const glOptionsFor = (t: BankTransaction) => glChoicesFor(t).map(({ id, label }) => ({ id, label }));
  /** Picking a GL account; Accounts Payable means the line pays a bill, so the bill is picked instead (a bill payment, no new expense). */
  const setGl = (t: BankTransaction, id: string) => {
    const choice = id ? glChoicesFor(t).find((c) => c.id === id) : undefined;
    if (choice?.kind === "payable") {
      if (t.amount > 0) showToast("Money coming in can't pay a bill. Pick an income account.", "error");
      else onOpen(t.id, "payBill");
      return;
    }
    onUpdate(t.id, { categoryId: id || undefined });
  };
  const refreshAction = onRefreshAccounts ? { label: "Missing an account? Refresh the list", onClick: onRefreshAccounts } : undefined;
  const glName = (id: string | undefined) => (id ? (lookups.glById.get(id)?.name ?? ledgerNameById.get(id)) : undefined);
  const blocked = ledgerBlock(ledger.reason, ledger.error, providerName);
  const taxOptions = useMemo(() => lookups.taxCodes.map((t) => ({ id: taxCodeId(t), label: taxCodeLabel(t) })), [lookups.taxCodes]);
  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const bounds = dateBounds(period, { from, to }, localToday());
  // Counts follow the date filter, so each tab's number is what it shows.
  const counts = useMemo(() => {
    const dated = txns.filter((t) => inDates(t.date, bounds));
    const by = (tab: ListTab) => dated.filter((t) => tabOf(t) === tab).length;
    return { all: dated.length, review: by("review"), posted: by("posted"), matched: by("matched"), transfers: by("transfers") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, bounds?.from, bounds?.to]);
  const suggestions = useMemo(
    () => findStrongSuggestions(txns, invoices, closedBills).filter((s) => !dismissed.has(s.txn.id)),
    [txns, invoices, closedBills, dismissed],
  );
  const accountNames = useMemo(() => Array.from(new Set(txns.map((t) => t.accountName).filter(Boolean))).sort(), [txns]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return txns
      .filter((t) => inTab(t, view))
      .filter((t) => !account || t.accountName === account)
      .filter((t) => inDates(t.date, bounds))
      .filter((t) => !q || `${t.description} ${t.accountName} ${t.payee ?? ""} ${t.merchantName ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, view, account, bounds?.from, bounds?.to, search]);
  // "ScanTrix is sure": lines to review it filled in, or would ("Suggest only"),
  // shown in their own section on top and not again below. A line in the
  // suggested bill matches stays there instead.
  const sureLines = useMemo(() => {
    if (view !== "review") return [];
    const matching = new Set(suggestions.map((s) => s.txn.id));
    return rows.filter((t) => isSureLine(t) && !matching.has(t.id));
  }, [rows, view, suggestions]);
  const sureIds = useMemo(() => new Set(sureLines.map((t) => t.id)), [sureLines]);
  // One list: the lines ScanTrix picked first, lightly highlighted, then the rest (Saurabh, 13 Nov).
  const listRows = useMemo(() => (sureIds.size === 0 ? rows : [...sureLines, ...rows.filter((t) => !sureIds.has(t.id))]), [rows, sureIds, sureLines]);

  if (txns.length === 0 && loading) {
    return (
      <div className="flex items-center justify-center gap-[var(--space-sm)] p-[var(--space-xl)] text-body-sm text-content-secondary">
        <Spinner size="sm" />
        Loading transactions…
      </div>
    );
  }

  if (txns.length === 0) {
    return (
      <div className="flex flex-col items-center pb-[var(--space-lg)]">
        <EmptyState
          icon={<Landmark size={28} strokeWidth={1.75} />}
          title="No transactions yet"
          description="Import a CSV file from your bank, or connect a bank with Plaid to bring in transactions."
        />
        <div className="flex flex-wrap justify-center gap-[var(--space-sm)]">
          <Button variant="outline" size="sm" onClick={onImportFile}>
            Import file
          </Button>
          {onConnect && (
            <Button variant="outline" size="sm" onClick={onConnect}>
              Connect a bank with Plaid
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Post and Accept also send to QuickBooks/Xero (Saurabh, 11 Nov: "nothing in
  // between"), when sending works now; a match also needs its bill there.
  const sendsNow = Boolean(onSend) && !blocked;
  const acceptAll = async () => {
    const n = suggestions.length;
    const waiting = sendsNow ? suggestions.filter((s) => !s.invoice.billId).length : 0;
    const ok = await confirmDialog({
      title: sendsNow ? `Accept and send ${n} match${n === 1 ? "" : "es"}?` : `Accept ${n} strong match${n === 1 ? "" : "es"}?`,
      message: sendsNow
        ? `Each bank line is matched to the bill from the same vendor with the same amount, dated within 7 days, and the payment is sent to ${providerName} on that bill. A sent line can only be changed in ${providerName}.${waiting > 0 ? ` ${waiting} of them will wait in Matched: their bill isn't in ${providerName} yet.` : ""}`
        : "Each bank line is matched to the bill from the same vendor with the same amount, dated within 7 days. You can still change a match afterwards.",
      confirmLabel: sendsNow ? "Accept & send all" : "Accept all",
    });
    if (!ok) return;
    onAcceptMatches(suggestions);
  };

  const selectedIds = Array.from(selected).filter((id) => rows.some((r) => r.id === id));
  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
  const postable = selectedRows.filter((r) => r.status === "review").map((r) => ({ r, patch: postPatch(r, lookups) }));
  const sendableSelected = selectedRows.filter(isUnsent);
  // Lines with no receipt and no bill behind them (paperwork requests).
  const needsPaperwork = selectedRows.filter((r) => !r.attachments?.length && !r.matchedInvoiceId);
  const unsentInTab = rows.filter(isUnsent);
  const postSelected = async () => {
    const ready = postable.filter((p) => p.patch);
    const missing = postable.length - ready.length;
    if (ready.length === 0) {
      showToast("Pick a GL account on the selected lines first.", "warning");
      return;
    }
    if (sendsNow && ready.length > 1) {
      const ok = await confirmDialog({
        title: `Post ${ready.length} lines to ${providerName}?`,
        message: `Each line is sent to ${providerName} with the vendor, GL account and tax code it shows. A sent line can only be changed in ${providerName}.`,
        confirmLabel: `Post ${ready.length}`,
      });
      if (!ok) return;
    }
    onPost(ready.map((p) => ({ txn: p.r, patch: p.patch as Partial<BankTransaction> })));
    if (missing > 0) showToast(`${missing} line${missing === 1 ? "" : "s"} skipped: no GL account yet.`, "info");
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Saves one field of the row's coding. Picking a vendor fills an empty GL / tax from the vendor's defaults. */
  const setVendor = (t: BankTransaction, vendorId: string) => {
    const v = lookups.vendorById.get(vendorId);
    const shown = codingFor(t);
    onUpdate(t.id, {
      vendorId: vendorId || undefined,
      payee: v?.displayName ?? undefined,
      ...(v?.glAccountId && !shown.glAccountId ? { categoryId: v.glAccountId } : {}),
      ...(v?.taxCodeId && !shown.taxCodeId ? { taxCodeId: v.taxCodeId } : {}),
    });
  };

  const editable = (t: BankTransaction) => t.status === "review";
  // Dashed outline: ScanTrix filled it in and no person has confirmed it yet.
  const fieldTone = (t: BankTransaction) => (isSuggestedField(t) ? "suggested" : "default");

  const columns: DataTableColumn<BankTransaction>[] = [
    { key: "date", header: "Date", width: LINE_COLUMN_WIDTH.date, render: (t) => <span className="whitespace-nowrap">{t.date}</span> },
    {
      key: "description",
      header: "Description",
      width: LINE_COLUMN_WIDTH.description,
      render: (t) => (
        <button type="button" onClick={() => onOpen(t.id)} className="block w-full min-w-0 text-left" title="Open details">
          <span className="block truncate font-semibold text-content-primary hover:underline">{t.description || "—"}</span>
          <span className="block truncate text-content-secondary">{t.accountName || "—"}</span>
          {t.postingStatus === "failed" && (
            <span className="flex items-start gap-0.5 font-semibold text-status-danger-text" title={t.posting?.error ?? undefined}>
              <AlertTriangle size={12} strokeWidth={2.25} className="mt-0.5 shrink-0" />
              <span className="line-clamp-2">Not sent to {providerName}: {t.posting?.error ?? "try again."}</span>
            </span>
          )}
          {t.status === "review" && (t.ledgerCandidates?.length ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 truncate font-semibold text-status-warning-text" title={`An entry with the same amount is already in ${providerName}. Open the line to check it.`}>
              <AlertTriangle size={12} strokeWidth={2.25} className="shrink-0" />
              Possibly in {providerName}: check
            </span>
          )}
        </button>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      width: LINE_COLUMN_WIDTH.amount,
      align: "right",
      render: (t) => <span className={`font-semibold ${t.amount < 0 ? "text-status-danger-text" : "text-status-success-text"}`}>{formatAmount(t.amount)}</span>,
    },
    {
      key: "vendor",
      header: "Vendor",
      width: LINE_COLUMN_WIDTH.vendor,
      render: (t) => {
        if (sureIds.has(t.id)) {
          const v = sureValues(t);
          const name = (v.vendorId && lookups.vendorById.get(v.vendorId)?.displayName) || v.payee;
          return name ? <span className="block truncate font-semibold">{name}</span> : <span className="block truncate text-content-muted">No vendor</span>;
        }
        const c = codingFor(t);
        if (!editable(t)) return <span className="block truncate text-content-secondary">{(c.vendorId && lookups.vendorById.get(c.vendorId)?.displayName) || t.payee || "—"}</span>;
        const box = (
          <CreatableCombobox
            floating
            options={vendorOptions}
            noun="vendor"
            ariaLabel={`Vendor for ${t.description}`}
            value={c.vendorId ?? ""}
            valueLabel={!c.vendorId ? c.payee : undefined}
            picks={
              !c.vendorId && c.offered?.vendorId
                ? [{ id: c.offered.vendorId, reason: c.suggestion?.linkedVendor ? "Picked for this payee before" : "From earlier lines for this payee" }]
                : undefined
            }
            tone={fieldTone(t)}
            title={c.reason ?? undefined}
            placeholder="Vendor"
            clearLabel="No vendor"
            onSelect={(id) => setVendor(t, id)}
            // One vendor box, like the invoice screen: a name that isn't a vendor
            // yet is added from here, with ScanTrix's clean name offered first.
            suggestedNew={newVendorName(t)}
            onAddNew={(name) => setAdding({ txnId: t.id, kind: "vendor", name: name || newVendorName(t) })}
          />
        );
        return box;
      },
    },
    {
      key: "gl",
      header: "GL account",
      width: LINE_COLUMN_WIDTH.gl,
      render: (t) => {
        if (sureIds.has(t.id)) {
          const v = sureValues(t);
          const why = picksFor(t, lookups, glName).find((p) => p.pick.glAccountId === v.glAccountId)?.reason ?? codingFor(t).reason?.replace(/^Coded by ScanTrix — /, "") ?? "";
          return (
            <>
              <span className="block truncate font-semibold">{glName(v.glAccountId) || "—"}</span>
              <span className="line-clamp-2 text-content-secondary" title={why}>
                {why}
              </span>
            </>
          );
        }
        const c = codingFor(t);
        if (!editable(t)) {
          const matched = t.matchedInvoiceId ? invoiceById.get(t.matchedInvoiceId) : undefined;
          return (
            <span className="block truncate text-content-secondary">
              {t.posting?.found
                ? `Found in ${providerName}: ${t.posting.found.label}${t.posting.found.name ? ` · ${t.posting.found.name}` : ""}`
                : t.status === "matched" ? `Bill: ${matched ? `${matched.vendor}${matched.number ? ` #${matched.number}` : ""}` : "matched"}` : t.status === "transfer" ? `Transfer · ${t.transferAccount ?? ""}` : glName(c.glAccountId) || "—"}
            </span>
          );
        }
        return (
          <CreatableCombobox
            floating
            options={glOptionsFor(t)}
            noun="GL account"
            ariaLabel={`GL account for ${t.description}`}
            value={c.glAccountId ?? ""}
            tone={fieldTone(t)}
            title={c.reason ?? undefined}
            placeholder="GL account"
            clearLabel="No GL account"
            picks={picksFor(t, lookups, glName).map((p) => ({ id: p.pick.glAccountId, reason: p.reason, badge: <ConfidenceLabel level={p.pick.confidence} ai={p.pick.step === "ai"} /> }))}
            onSelect={(id) => setGl(t, id)}
            onAddNew={(name) => setAdding({ txnId: t.id, kind: "gl", name })}
            footerAction={refreshAction}
          />
        );
      },
    },
    {
      key: "tax",
      header: "Tax",
      width: LINE_COLUMN_WIDTH.tax,
      render: (t) => {
        if (sureIds.has(t.id)) {
          const tax = sureValues(t).taxCodeId ? lookups.taxById.get(sureValues(t).taxCodeId as string) : undefined;
          return tax ? <span className="block truncate font-semibold">{taxCodeLabel(tax)}</span> : <span className="block truncate text-content-muted">No tax</span>;
        }
        const c = codingFor(t);
        const label = c.taxCodeId ? lookups.taxById.get(c.taxCodeId) : undefined;
        if (!editable(t)) return <span className="block truncate text-content-secondary">{label ? taxCodeLabel(label) : "—"}</span>;
        if (taxOptions.length === 0) return <span className="text-content-muted">—</span>;
        return (
          <CreatableCombobox
            floating
            options={taxOptions}
            noun="tax code"
            ariaLabel={`Tax code for ${t.description}`}
            value={c.taxCodeId ?? ""}
            tone={fieldTone(t)}
            placeholder="Tax"
            clearLabel="No tax code"
            onSelect={(id) => onUpdate(t.id, { taxCodeId: id || undefined })}
          />
        );
      },
    },
    {
      key: "paperwork",
      header: <Paperclip size={13} strokeWidth={2.25} aria-label="Invoice or receipt" />,
      width: LINE_COLUMN_WIDTH.paperwork,
      render: (t) => {
        if (t.matchedInvoiceId) {
          const inv = invoiceById.get(t.matchedInvoiceId);
          return (
            <Link href={`/invoices/${t.matchedInvoiceId}`} title={inv ? `${inv.vendor}${inv.number ? ` #${inv.number}` : ""} in ScanTrix` : "Invoice in ScanTrix"} className="inline-flex text-accent hover:opacity-80">
              <Paperclip size={16} strokeWidth={2.25} />
            </Link>
          );
        }
        if (t.attachments?.length) {
          const [first] = t.attachments;
          return (
            <button
              type="button"
              onClick={() => qbConnectionId && openAttachment(qbConnectionId, t.id, first.id).catch((e: Error) => showToast(e.message, "error"))}
              title={`Receipt: ${t.attachments.map((a) => a.name).join(", ")}`}
              className="inline-flex text-accent hover:opacity-80"
            >
              <Paperclip size={16} strokeWidth={2.25} />
            </button>
          );
        }
        // No bill and no receipt: shown faintly, so missing paperwork stands out.
        return (
          <span title="No receipt or bill yet. Select the line and use Request paperwork." className="inline-flex text-content-muted opacity-40">
            <Paperclip size={16} strokeWidth={2.25} aria-label="No receipt" />
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      width: LINE_COLUMN_WIDTH.actions,
      align: "right",
      render: (t) => {
        if (sureIds.has(t.id)) {
          return (
            <span className="inline-flex items-center gap-[var(--space-xs)]">
              <Button size="sm" onClick={() => void postSure([t])} title={sendsNow ? `Post to ${providerName} with the vendor, GL and tax shown` : "Save as ready to post, with the vendor, GL and tax shown"}>
                Post
              </Button>
              <button type="button" className={ROW_BTN} onClick={() => onOpen(t.id)} title="Change the vendor, GL account or tax first">
                Change
              </button>
            </span>
          );
        }
        if (t.postingStatus === "posted") {
          // In the books: locked here; a change is made in QuickBooks/Xero itself.
          const label = `In ${providerName}`;
          if (t.posting?.found) {
            // Entered straight into QuickBooks/Xero; ScanTrix only linked it, so it can be put back.
            return (
              <span className="inline-flex items-center gap-[var(--space-xs)]">
                {t.posting.url ? (
                  <a href={t.posting.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption font-semibold text-status-success-text hover:underline" title={`Open in ${providerName}`}>
                    {label}
                    <ExternalLink size={12} strokeWidth={2.25} />
                  </a>
                ) : (
                  <Badge variant="success">{label}</Badge>
                )}
                {onUnlinkFound && (
                  <button type="button" className={ROW_BTN} onClick={() => onUnlinkFound(t.id)} title={`Not this entry: put the line back in To review`}>
                    <Undo2 size={13} strokeWidth={2.25} />
                    Not this
                  </button>
                )}
              </span>
            );
          }
          return t.posting?.url ? (
            <a href={t.posting.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption font-semibold text-status-success-text hover:underline" title={`Open in ${providerName}`}>
              {label}
              <ExternalLink size={12} strokeWidth={2.25} />
            </a>
          ) : (
            <Badge variant="success">{label}</Badge>
          );
        }
        if (t.status !== "review") {
          const undo: Partial<BankTransaction> =
            t.status === "transfer" ? { status: "review", transferAccount: undefined } : t.status === "matched" ? { status: "review", matchedInvoiceId: undefined } : { status: "review" };
          const sending = sendingIds.has(t.id) || t.postingStatus === "processing";
          const failed = t.postingStatus === "failed" ? (t.posting?.error ?? "Couldn't send.") : null;
          return (
            <span className="inline-flex items-center gap-[var(--space-xs)]">
              {failed ? (
                <span title={failed} className="inline-flex max-w-[96px] items-center gap-0.5 truncate text-caption font-semibold text-status-danger-text">
                  <AlertTriangle size={13} strokeWidth={2.25} className="shrink-0" />
                  Not sent
                </span>
              ) : (
                <Badge variant={t.status === "matched" || t.status === "ready" ? "success" : "neutral"}>{STATUS_LABEL[t.status]}</Badge>
              )}
              {onSend && SENDABLE.includes(t.status) && (
                <Button size="sm" disabled={sending || Boolean(blocked)} title={blocked ?? (failed ? `${failed} Fix it and try again.` : `Send to ${providerName}`)} onClick={() => onSend([t.id])}>
                  {sending ? <Spinner size="sm" /> : <Send size={13} strokeWidth={2.25} />}
                  {failed ? "Retry" : "Send"}
                </Button>
              )}
              <button type="button" className={ROW_BTN} disabled={sending} onClick={() => onUpdate(t.id, undo)} title={t.status === "excluded" ? "Restore" : "Undo"}>
                <Undo2 size={13} strokeWidth={2.25} />
                {t.status === "excluded" ? "Restore" : "Undo"}
              </button>
            </span>
          );
        }
        const patch = postPatch(t, lookups);
        return (
          <span className="inline-flex items-center gap-[var(--space-xs)]">
            <Button size="sm" disabled={!patch} title={patch ? `Post to ${providerName}` : "Pick a GL account first"} onClick={() => patch && onPost([{ txn: t, patch }])}>
              Post
            </Button>
            <button type="button" className={ROW_BTN} onClick={() => onOpen(t.id, "match")} title="Match to a bill or an entry already in the books">
              Match
            </button>
            <button type="button" className={ROW_BTN} onClick={() => onOpen(t.id, "transfer")} title="Money moved between your own accounts">
              <ArrowLeftRight size={13} strokeWidth={2.25} />
            </button>
            <button type="button" className={ROW_BTN} onClick={() => onUpdate(t.id, { status: "excluded", matchedInvoiceId: undefined })} title="Exclude: not part of the books">
              <EyeOff size={13} strokeWidth={2.25} />
            </button>
          </span>
        );
      },
    },
  ];

  /** What ScanTrix would code a sure line to: its own fill, or the High suggestion ("Suggest only"). */
  const sureValues = (t: BankTransaction) => {
    const c = codingFor(t);
    return c.source === "autopilot" ? c : { ...c, ...(c.offered ?? {}) };
  };
  const postSure = async (lines: BankTransaction[]) => {
    const items = lines.flatMap((t) => {
      const patch = surePatch(t);
      return patch ? [{ txn: t, patch }] : [];
    });
    if (items.length === 0) return;
    if (items.length > 1) {
      const ok = await confirmDialog({
        title: `Post ${items.length} lines${sendsNow ? ` to ${providerName}` : ""}?`,
        message: `Each line is posted with the vendor, GL account and tax code shown.${sendsNow ? ` A sent line can only be changed in ${providerName}.` : ""}`,
        confirmLabel: `Post ${items.length}`,
      });
      if (!ok) return;
    }
    onPost(items);
  };

  // The line a vendor or GL account is being added from, as it is shown now.
  const addingTxn = adding ? txns.find((x) => x.id === adding.txnId) : undefined;
  const addingCoding = addingTxn ? codingFor(addingTxn) : null;
  // The vendor form, opened from a line: clean name, the suggested GL, no tax; the currency is left for the person to pick.
  const vendorDefaults =
    adding?.kind === "vendor" && addingTxn
      ? vendorFormDefaults({
          typed: adding.name,
          suggestedName: newVendorName(addingTxn),
          glAccountId: addingCoding?.glAccountId ?? addingCoding?.offered?.glAccountId,
          currency: lineCurrency(addingTxn, { bankAccounts, named, chart: ledger.accounts, homeCurrency }),
        })
      : null;
  /** A clean vendor name for a payee ScanTrix doesn't know ("Tim Hortons", not "TIM HORTONS #1234 TORONTO"). */
  function newVendorName(t: BankTransaction): string {
    const c = codingFor(t);
    return c.suggestion?.payee || suggestedVendorName(t.merchantName, t.description);
  }

  return (
    <div>
      <div className="flex flex-col gap-[var(--space-sm)] border-b border-border bg-page p-[var(--space-md)]">
        <p className="text-caption text-content-secondary">
          {counts.all} total · {counts.review} to review · {counts.posted} posted · {counts.matched} matched · {counts.transfers} transfers or excluded
        </p>
        <div className="flex flex-col gap-[var(--space-sm)] lg:flex-row lg:flex-wrap lg:items-center">
          <Tabs
            items={(["review", "posted", "matched", "transfers", "all"] as const).map((v) => ({ value: v, label: TAB_LABEL[v], count: counts[v] }))}
            value={view}
            onChange={(v) => setView(v as ListTab)}
          />
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transactions…" widthClassName="w-full lg:w-72" />
          <SelectDropdown uiSize="sm" aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accountNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectDropdown>
          <SelectDropdown uiSize="sm" aria-label="Dates" value={period} onChange={(e) => setPeriod(e.target.value as DatePeriod)}>
            {(Object.keys(PERIOD_LABEL) as DatePeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </SelectDropdown>
          {period === "custom" && (
            <div className="flex items-center gap-[var(--space-xs)]">
              <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
              <span className="text-caption text-content-secondary">to</span>
              <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
            </div>
          )}
          {bounds && period !== "custom" && <span className="text-caption text-content-secondary">{bounds.from} to {bounds.to}</span>}
        </div>
        {view === "review" && (
          <RoleInfoBanner>
            {sendsNow
              ? `Post sends a line to ${providerName} straight away, with its vendor, GL account and tax code. It then moves to Posted.`
              : `Post saves a line as ready, with its vendor, GL account and tax code. It stays here until it is sent to ${providerName}.`}
          </RoleInfoBanner>
        )}
        {view !== "posted" && view !== "all" && blocked && <RoleInfoBanner>{blocked}</RoleInfoBanner>}
        {view !== "posted" && view !== "all" && !blocked && onSend && unsentInTab.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
            <p className="text-caption text-content-secondary">
              {unsentInTab.length} {unsentInTab.length === 1 ? "line isn't" : "lines aren't"} in {providerName} yet. Each line is sent once; a sent line can only be changed in {providerName}.
            </p>
            <Button size="sm" disabled={unsentInTab.every((t) => sendingIds.has(t.id))} onClick={() => onSend(unsentInTab.map((t) => t.id))}>
              <Send size={13} strokeWidth={2.25} />
              Send {unsentInTab.length} to {providerName}
            </Button>
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-[var(--space-sm)] border-b border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]">
          <span className="text-body-sm font-semibold text-content-primary">{selectedIds.length} selected</span>
          {postable.length > 0 && (
            <Button size="sm" onClick={postSelected}>
              Post {postable.length} selected
            </Button>
          )}
          {onSend && !blocked && sendableSelected.length > 0 && (
            <Button
              size="sm"
              onClick={() => {
                onSend(sendableSelected.map((t) => t.id));
                setSelected(new Set());
              }}
            >
              Send {sendableSelected.length} to {providerName}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onBulkUpdate(selectedIds, { status: "excluded", matchedInvoiceId: undefined });
              setSelected(new Set());
            }}
          >
            Exclude selected
          </Button>
          {needsPaperwork.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setRequesting(needsPaperwork)} title="Ask a team member for the receipts of the selected lines that have none">
              <FileQuestion size={14} strokeWidth={2.25} />
              Request paperwork{needsPaperwork.length < selectedRows.length ? ` (${needsPaperwork.length})` : ""}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {view === "review" && (
        <SuggestedMatches
          suggestions={suggestions}
          lookups={lookups}
          providerName={providerName}
          sends={sendsNow}
          onAccept={(s) => onAcceptMatches([s])}
          onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))}
          onAcceptAll={acceptAll}
        />
      )}

      {sureLines.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] border-b border-border bg-status-success-bg/40 px-[var(--space-md)] py-[var(--space-xs)]">
          <p className="flex items-center gap-[var(--space-xs)] text-caption text-content-primary">
            <CheckCircle2 size={14} strokeWidth={2.25} className="text-status-success-text" />
            ScanTrix picked {sureLines.length} line{sureLines.length === 1 ? "" : "s"} (highlighted, at the top): 3 past lines on the same vendor, GL and tax. Check, then post.
          </p>
          <Button size="sm" onClick={() => void postSure(sureLines)}>
            Post all {sureLines.length}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No transactions match these filters.</div>
      ) : (
        <DataTable
          columns={columns}
          rows={listRows}
          getRowClassName={(t) => (sureIds.has(t.id) ? "bg-status-success-bg/40" : "")}
          getRowKey={(t) => t.id}
          bordered={false}
          maxHeightClassName="max-h-[640px]"
          selectedKeys={selected}
          onToggleRow={(t) => toggle(t.id)}
        />
      )}

      {requesting && (
        <RequestPaperworkModal
          lines={requesting}
          onClose={() => setRequesting(null)}
          onSent={() => {
            setSelected(new Set());
            onPaperworkRequested?.();
          }}
        />
      )}
      <AddVendorModalV2
        open={adding?.kind === "vendor"}
        onClose={() => setAdding(null)}
        initialName={vendorDefaults?.name ?? ""}
        initialGlAccountId={vendorDefaults?.glAccountId ?? ""}
        initialTaxCodeId={vendorDefaults?.taxCodeId ?? ""}
        initialCurrency={vendorDefaults?.currency}
        onCreated={(vendor) => {
          if (!adding) return;
          onUpdate(adding.txnId, newVendorPatch(vendor, addingCoding ?? {}));
        }}
      />
      <AddGlAccountModalV2
        open={adding?.kind === "gl"}
        onClose={() => setAdding(null)}
        initialName={adding?.kind === "gl" ? adding.name : ""}
        onCreated={(gl) => {
          if (adding) onUpdate(adding.txnId, { categoryId: gl.qbAccountId });
        }}
      />
    </div>
  );
}
