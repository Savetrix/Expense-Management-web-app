"use client";

import { ArrowLeftRight, EyeOff, FilePlus2, Landmark, Paperclip, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

import { codingFor, isSuggestedField, type Lookups } from "./coding";
import { formatAmount } from "./format";
import { findStrongSuggestions, paperworkHref } from "./matching";
import { SuggestedMatches } from "./SuggestedMatches";
import { STATUS_LABEL } from "./TransactionModal";
import type { BankTransaction, BankTxnStatus, InvoiceCandidate } from "./types";

// The bank lines, coded on the row: vendor, GL account and tax code are
// dropdowns in the line itself (pick one or add one), pre-filled when the payee
// was seen before, and Post / Match / Transfer / Exclude sit at the end of the
// line. The detail dialog (click the description) holds everything else.

type StatusFilter = BankTxnStatus | "all";

interface TransactionsTabProps {
  txns: BankTransaction[];
  providerName: string;
  onImportFile: () => void;
  onConnect: () => void;
  /** Opens the detail dialog; `focus` = which part to show first. */
  onOpen: (id: string, focus?: "match" | "transfer") => void;
  onUpdate: (id: string, patch: Partial<BankTransaction>) => void;
  invoices: InvoiceCandidate[];
  onBulkUpdate: (ids: string[], patch: Partial<BankTransaction>) => void;
  /** Different changes for many lines in one request (accept all matches, post selected). */
  onBulkItems: (items: ({ id: string } & Partial<BankTransaction>)[]) => void;
  lookups: Lookups;
  /** First load from the server still running. */
  loading?: boolean;
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
  onBulkUpdate,
  onBulkItems,
  lookups,
  loading = false,
}: TransactionsTabProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusFilter>("review");
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ txnId: string; kind: "vendor" | "gl"; name: string } | null>(null);

  const vendorOptions = useMemo(() => lookups.vendors.map((v) => ({ id: v._id, label: v.displayName })), [lookups.vendors]);
  const glOptions = useMemo(() => lookups.glAccounts.map((a) => ({ id: a.qbAccountId, label: a.name })), [lookups.glAccounts]);
  const taxOptions = useMemo(() => lookups.taxCodes.map((t) => ({ id: taxCodeId(t), label: taxCodeLabel(t) })), [lookups.taxCodes]);
  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const counts = useMemo(() => {
    const by = (s: BankTxnStatus) => txns.filter((t) => t.status === s).length;
    return { total: txns.length, review: by("review"), ready: by("ready"), matched: by("matched"), excluded: by("excluded"), transfer: by("transfer") };
  }, [txns]);
  const suggestions = useMemo(
    () => findStrongSuggestions(txns, invoices).filter((s) => !dismissed.has(s.txn.id)),
    [txns, invoices, dismissed],
  );
  const accountNames = useMemo(() => Array.from(new Set(txns.map((t) => t.accountName).filter(Boolean))).sort(), [txns]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return txns
      .filter((t) => status === "all" || t.status === status)
      .filter((t) => !account || t.accountName === account)
      .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
      .filter((t) => !q || `${t.description} ${t.accountName} ${t.payee ?? ""} ${t.merchantName ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [txns, status, account, from, to, search]);

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
          <Button variant="outline" size="sm" onClick={onConnect}>
            Connect a bank with Plaid
          </Button>
        </div>
      </div>
    );
  }

  const acceptOne = (s: { txn: BankTransaction; invoice: InvoiceCandidate }) => {
    onUpdate(s.txn.id, { status: "matched", matchedInvoiceId: s.invoice.id });
  };
  const acceptAll = async () => {
    const ok = await confirmDialog({
      title: `Accept ${suggestions.length} strong match${suggestions.length === 1 ? "" : "es"}?`,
      message: "Each bank line is matched to the bill with the same amount dated within 7 days. You can still change a match afterwards.",
      confirmLabel: "Accept all",
    });
    if (!ok) return;
    onBulkItems(suggestions.map((s) => ({ id: s.txn.id, status: "matched" as const, matchedInvoiceId: s.invoice.id })));
  };

  const selectedIds = Array.from(selected).filter((id) => rows.some((r) => r.id === id));
  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
  const paperworkTargets = selectedRows.filter((r) => r.amount < 0 && r.status === "review" && !r.matchedInvoiceId);
  const postable = selectedRows.filter((r) => r.status === "review").map((r) => ({ r, patch: postPatch(r, lookups) }));
  const askForPaperwork = async () => {
    const first = paperworkTargets[0];
    if (!first) return;
    const ok = await confirmDialog({
      title: `Ask for paperwork for ${paperworkTargets.length} selected?`,
      message:
        paperworkTargets.length === 1
          ? "This opens the request form filled in from this bank line."
          : `The request form takes one item at a time, so it opens for the first one ("${first.description}"). Come back for the others afterwards.`,
      confirmLabel: "Open request form",
    });
    if (ok) router.push(paperworkHref(first));
  };
  const postSelected = () => {
    const ready = postable.filter((p) => p.patch);
    const missing = postable.length - ready.length;
    if (ready.length === 0) {
      showToast("Pick a GL account on the selected lines first.", "warning");
      return;
    }
    onBulkItems(ready.map((p) => ({ id: p.r.id, ...(p.patch as Partial<BankTransaction>) })));
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
  const fieldTone = (t: BankTransaction, field: "vendorId" | "categoryId" | "taxCodeId") => (isSuggestedField(t, field) ? "suggested" : "default");

  const columns: DataTableColumn<BankTransaction>[] = [
    { key: "date", header: "Date", width: "96px", render: (t) => <span className="whitespace-nowrap">{t.date}</span> },
    {
      key: "description",
      header: "Description",
      width: "22%",
      render: (t) => (
        <button type="button" onClick={() => onOpen(t.id)} className="block w-full min-w-0 text-left" title="Open details">
          <span className="block truncate font-semibold text-content-primary hover:underline">{t.description || "—"}</span>
          <span className="block truncate text-content-secondary">{t.accountName || "—"}</span>
        </button>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      width: "104px",
      align: "right",
      render: (t) => <span className={`font-semibold ${t.amount < 0 ? "text-status-danger-text" : "text-status-success-text"}`}>{formatAmount(t.amount)}</span>,
    },
    {
      key: "vendor",
      header: "Vendor",
      width: "15%",
      render: (t) => {
        const c = codingFor(t);
        if (!editable(t)) return <span className="block truncate text-content-secondary">{(c.vendorId && lookups.vendorById.get(c.vendorId)?.displayName) || t.payee || "—"}</span>;
        return (
          <CreatableCombobox
            floating
            options={vendorOptions}
            noun="vendor"
            ariaLabel={`Vendor for ${t.description}`}
            value={c.vendorId ?? ""}
            valueLabel={!c.vendorId ? c.payee : undefined}
            tone={fieldTone(t, "vendorId")}
            title={c.reason ?? undefined}
            placeholder="Vendor"
            clearLabel="No vendor"
            onSelect={(id) => setVendor(t, id)}
            onAddNew={(name) => setAdding({ txnId: t.id, kind: "vendor", name: name || t.merchantName || "" })}
          />
        );
      },
    },
    {
      key: "gl",
      header: "GL account",
      width: "17%",
      render: (t) => {
        const c = codingFor(t);
        if (!editable(t)) {
          const matched = t.matchedInvoiceId ? invoiceById.get(t.matchedInvoiceId) : undefined;
          return (
            <span className="block truncate text-content-secondary">
              {t.status === "matched" ? `Bill: ${matched ? `${matched.vendor}${matched.number ? ` #${matched.number}` : ""}` : "matched"}` : t.status === "transfer" ? `Transfer · ${t.transferAccount ?? ""}` : (c.glAccountId && lookups.glById.get(c.glAccountId)?.name) || "—"}
            </span>
          );
        }
        return (
          <CreatableCombobox
            floating
            options={glOptions}
            noun="GL account"
            ariaLabel={`GL account for ${t.description}`}
            value={c.glAccountId ?? ""}
            tone={fieldTone(t, "categoryId")}
            title={c.reason ?? undefined}
            placeholder="GL account"
            clearLabel="No GL account"
            onSelect={(id) => onUpdate(t.id, { categoryId: id || undefined })}
            onAddNew={(name) => setAdding({ txnId: t.id, kind: "gl", name })}
          />
        );
      },
    },
    {
      key: "tax",
      header: "Tax",
      width: "12%",
      render: (t) => {
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
            tone={fieldTone(t, "taxCodeId")}
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
      width: "56px",
      render: (t) => {
        if (t.matchedInvoiceId) {
          const inv = invoiceById.get(t.matchedInvoiceId);
          return (
            <Link href={`/invoices/${t.matchedInvoiceId}`} title={inv ? `${inv.vendor}${inv.number ? ` #${inv.number}` : ""} in Scantrix` : "Invoice in Scantrix"} className="inline-flex text-accent hover:opacity-80">
              <Paperclip size={16} strokeWidth={2.25} />
            </Link>
          );
        }
        if (t.amount < 0 && (t.status === "review" || t.status === "ready")) {
          return (
            <Link href={paperworkHref(t)} title="Ask for the invoice or receipt" className="inline-flex items-center gap-0.5 text-caption font-semibold text-content-secondary hover:text-content-primary">
              <FilePlus2 size={14} strokeWidth={2.25} />
              Ask
            </Link>
          );
        }
        return null;
      },
    },
    {
      key: "actions",
      header: "",
      width: "236px",
      align: "right",
      render: (t) => {
        if (t.status !== "review") {
          const undo: Partial<BankTransaction> =
            t.status === "transfer" ? { status: "review", transferAccount: undefined } : t.status === "matched" ? { status: "review", matchedInvoiceId: undefined } : { status: "review" };
          return (
            <span className="inline-flex items-center gap-[var(--space-xs)]">
              <Badge variant={t.status === "matched" || t.status === "ready" ? "success" : "neutral"}>{STATUS_LABEL[t.status]}</Badge>
              <button type="button" className={ROW_BTN} onClick={() => onUpdate(t.id, undo)} title={t.status === "excluded" ? "Restore" : "Undo"}>
                <Undo2 size={13} strokeWidth={2.25} />
                {t.status === "excluded" ? "Restore" : "Undo"}
              </button>
            </span>
          );
        }
        const patch = postPatch(t, lookups);
        return (
          <span className="inline-flex items-center gap-[var(--space-xs)]">
            <Button size="sm" disabled={!patch} title={patch ? `Post to ${providerName}` : "Pick a GL account first"} onClick={() => patch && onUpdate(t.id, patch)}>
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

  const anySuggested = rows.some((t) => t.status === "review" && (isSuggestedField(t, "categoryId") || isSuggestedField(t, "vendorId")));

  return (
    <div>
      <div className="flex flex-col gap-[var(--space-sm)] border-b border-border bg-page p-[var(--space-md)]">
        <p className="text-caption text-content-secondary">
          {counts.total} total · {counts.review} to review · {counts.ready} ready to post · {counts.matched} matched · {counts.transfer} transfer · {counts.excluded} excluded
        </p>
        <div className="flex flex-col gap-[var(--space-sm)] lg:flex-row lg:flex-wrap lg:items-center">
          <Tabs
            items={[
              { value: "review", label: "To review", count: counts.review },
              { value: "ready", label: "Ready to post", count: counts.ready },
              { value: "matched", label: "Matched", count: counts.matched },
              { value: "transfer", label: "Transfers", count: counts.transfer },
              { value: "excluded", label: "Excluded", count: counts.excluded },
              { value: "all", label: "All", count: counts.total },
            ]}
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
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
          <div className="flex items-center gap-[var(--space-xs)]">
            <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
            <span className="text-caption text-content-secondary">to</span>
            <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
          </div>
        </div>
        {(status === "review" || status === "ready") && (
          <RoleInfoBanner>
            Post saves a line as ready, with its vendor, GL account and tax code. Sending ready lines to {providerName}{" "}
            isn&apos;t switched on yet (BE).
          </RoleInfoBanner>
        )}
        {status === "review" && anySuggested && (
          <p className="flex items-center gap-[var(--space-xs)] text-caption text-content-secondary">
            <Sparkles size={13} strokeWidth={2.25} className="text-accent" />
            Fields with a dashed outline are filled in from earlier lines for the same payee. Post confirms them, or change any of them first.
          </p>
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
          {paperworkTargets.length > 0 && (
            <Button size="sm" variant="outline" onClick={askForPaperwork}>
              Ask for paperwork for {paperworkTargets.length} selected
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {status === "review" && (
        <SuggestedMatches
          suggestions={suggestions}
          onAccept={acceptOne}
          onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))}
          onAcceptAll={acceptAll}
        />
      )}

      {rows.length === 0 ? (
        <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No transactions match these filters.</div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(t) => t.id}
          bordered={false}
          maxHeightClassName="max-h-[640px]"
          selectedKeys={selected}
          onToggleRow={(t) => toggle(t.id)}
        />
      )}

      <AddVendorModalV2
        open={adding?.kind === "vendor"}
        onClose={() => setAdding(null)}
        initialName={adding?.kind === "vendor" ? adding.name : ""}
        onCreated={(vendor) => {
          if (!adding) return;
          const t = txns.find((x) => x.id === adding.txnId);
          const shown = t ? codingFor(t) : null;
          onUpdate(adding.txnId, {
            vendorId: vendor._id,
            payee: vendor.displayName,
            ...(vendor.glAccountId && !shown?.glAccountId ? { categoryId: vendor.glAccountId } : {}),
            ...(vendor.taxCodeId && !shown?.taxCodeId ? { taxCodeId: vendor.taxCodeId } : {}),
          });
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
