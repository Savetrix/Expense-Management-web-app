"use client";

import { CheckCircle2, CircleDashed, ExternalLink, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  CreatableCombobox,
  Modal,
  ModalDefinitionRow,
  SearchInput,
} from "@/components/v2/ui";
import { taxCodeId, taxCodeLabel } from "@/lib/quickbooks/taxCode";

import { ConfidenceLabel } from "@/components/v2/suggestions/ConfidenceLabel";
import { PicksExplained } from "@/components/v2/suggestions/PicksExplained";

import { codingFor, codingLabel, picksFor, type Lookups } from "./coding";
import { formatAmount } from "./format";
import { billsFor, isExactAmount, rankInvoices, vendorAgrees } from "./matching";
import { TransferModal } from "./TransferModal";
import type { BankAccount, BankTransaction, InvoiceCandidate } from "./types";
import { AddVendorModalV2 } from "@/components/v2/vendors/AddVendorModalV2";
import { suggestedVendorName } from "@/lib/suggestions/similar";
import type { LedgerAccountDto, NamedAccountDto } from "@/store/bankFeeds/bankFeedsApi";

import { bankLineGlChoices, lineCurrency, lineLedgerId, newVendorPatch, vendorFormDefaults } from "./glList";

/** Who the bill is from, to find it: the line's vendor, else ScanTrix's clean name for the payee. */
function payBillSearch(txn: BankTransaction, lookups: Lookups): string {
  const c = codingFor(txn);
  const vendor = c.vendorId ? lookups.vendorById.get(c.vendorId)?.displayName : undefined;
  return vendor || c.suggestion?.payee || suggestedVendorName(txn.merchantName, txn.description);
}

interface TransactionModalProps {
  txn: BankTransaction | null;
  invoices: InvoiceCandidate[];
  /** Bills that can't be matched any more (see closedBills); the line's own bill is still shown. */
  closedBills?: ReadonlySet<string>;
  lookups: Lookups;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<BankTransaction>) => void;
  /** Open on the transfer form instead of the details (the row's transfer button); "payBill": Accounts Payable was picked, so pick the bill. */
  initialFocus?: "match" | "transfer" | "payBill";
  /** Imported-file names and what they map to, the chart of accounts, and the home currency (glList.ts). */
  named?: NamedAccountDto[];
  chart?: LedgerAccountDto[];
  homeCurrency?: string | null;
  /** Reads the chart of accounts again (an account someone expects is missing). */
  onRefreshAccounts?: () => void;
  providerName?: string;
  /** Post: saves the line as ready and sends it to QuickBooks/Xero when it can. Absent: Post only saves. */
  onPost?: (patch: Partial<BankTransaction>) => void;
  /** Picks which entry already in QuickBooks/Xero is this line. */
  onLinkFound?: (key: string) => void;
  /** "Not this": a line found in QuickBooks/Xero goes back to To review. */
  onUnlinkFound?: () => void;
}

export const STATUS_LABEL: Record<BankTransaction["status"], string> = {
  review: "To review",
  ready: "Ready to post",
  matched: "Matched",
  excluded: "Excluded",
  transfer: "Transfer",
};

export function TransactionModal({
  txn,
  invoices,
  closedBills,
  lookups,
  bankAccounts,
  onClose,
  onUpdate,
  initialFocus,
  providerName = "QuickBooks",
  onPost,
  onLinkFound,
  onUnlinkFound,
  named = [],
  chart = [],
  homeCurrency = null,
  onRefreshAccounts,
}: TransactionModalProps) {
  const [transferOpen, setTransferOpen] = useState(initialFocus === "transfer");
  // Accounts Payable picked: this line pays a bill, so the bill is picked below (a bill payment, no new expense).
  const [payBill, setPayBill] = useState(initialFocus === "payBill");
  const [addingVendor, setAddingVendor] = useState<string | null>(null);
  const [search, setSearch] = useState(() => (initialFocus === "payBill" && txn ? payBillSearch(txn, lookups) : ""));
  const [pickedInvoice, setPickedInvoice] = useState("");
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [showChecks, setShowChecks] = useState(false);

  const ranked = useMemo(
    () => (txn ? rankInvoices(txn, closedBills ? billsFor(txn, invoices, closedBills) : invoices) : []),
    [txn, invoices, closedBills],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? ranked.filter((c) =>
          `${c.vendor} ${c.number}`.toLowerCase().includes(q),
        )
      : ranked;
  }, [ranked, search]);
  const glChoices = useMemo(
    () => (txn ? bankLineGlChoices({ chart, backendGl: lookups.glAccounts, lineLedgerId: lineLedgerId(txn, bankAccounts, named), moneyIn: txn.amount > 0 }) : []),
    [txn, chart, lookups.glAccounts, bankAccounts, named],
  );
  const glOptions = useMemo(() => glChoices.map(({ id, label }) => ({ id, label })), [glChoices]);
  const vendorOptions = useMemo(() => lookups.vendors.map((v) => ({ id: v._id, label: v.displayName })), [lookups.vendors]);
  const taxOptions = useMemo(() => lookups.taxCodes.map((t) => ({ id: taxCodeId(t), label: taxCodeLabel(t) })), [lookups.taxCodes]);

  if (!txn) return null;
  const excluded = txn.status === "excluded";
  const transfer = txn.status === "transfer";
  const ready = txn.status === "ready";
  // Someone entered this line straight into QuickBooks/Xero (foundInLedger.ts).
  const found = txn.posting?.found;
  const inactive = excluded || transfer || ready || Boolean(found);
  const candidates = txn.status === "review" ? (txn.ledgerCandidates ?? []) : [];
  const matchedInvoice = invoices.find((c) => c.id === txn.matchedInvoiceId);
  const coding = codingFor(txn);
  const suggestion = coding.suggestion;
  const linePicks = picksFor(txn, lookups);
  // A clean name for a payee that isn't a vendor yet ("Tim Hortons").
  const newVendorName = coding.suggestion?.payee || suggestedVendorName(txn.merchantName, txn.description);
  // The vendor form, opened from this line: clean name, the bank account's currency, the suggested GL, no tax.
  const vendorDefaults = vendorFormDefaults({
    typed: addingVendor ?? "",
    suggestedName: newVendorName,
    glAccountId: coding.glAccountId ?? coding.offered?.glAccountId,
    currency: lineCurrency(txn, { bankAccounts, named, chart, homeCurrency }),
  });
  // A suggestion ScanTrix didn't fill in (not sure enough, or "Suggest only").
  const offered = coding.offered;
  const pendingSuggestion = Boolean(offered);
  const useSuggestion = () => {
    if (!offered) return;
    const vendorName = offered.vendorId ? lookups.vendorById.get(offered.vendorId)?.displayName : undefined;
    const nextPayee = offered.payee ?? vendorName;
    if (nextPayee) setPayee(nextPayee);
    onUpdate(txn.id, { vendorId: offered.vendorId, categoryId: offered.glAccountId, taxCodeId: offered.taxCodeId, payee: nextPayee });
  };

  return (
    <>
      <Modal
        open={!transferOpen}
        onClose={onClose}
        title="Transaction"
        widthClassName="max-w-xl"
        footer={
          <>
            {found ? (
              onUnlinkFound && (
                <Button
                  variant="outline"
                  title={`Put this line back in To review. ScanTrix won't link it to this ${providerName} entry again.`}
                  onClick={() => {
                    onUnlinkFound();
                    onClose();
                  }}
                >
                  Not this
                </Button>
              )
            ) : excluded || ready ? (
              <Button
                variant="outline"
                onClick={() => onUpdate(txn.id, { status: "review" })}
              >
                {excluded ? "Restore" : "Back to review"}
              </Button>
            ) : transfer ? (
              <Button
                variant="outline"
                onClick={() =>
                  onUpdate(txn.id, {
                    status: "review",
                    transferAccount: undefined,
                  })
                }
              >
                Undo transfer
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() =>
                  onUpdate(txn.id, {
                    status: "excluded",
                    matchedInvoiceId: undefined,
                  })
                }
              >
                Exclude
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--space-lg)]">
          <div>
            <ModalDefinitionRow label="Date">{txn.date}</ModalDefinitionRow>
            <ModalDefinitionRow label="Description">
              <span className="truncate">{txn.description || "—"}</span>
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Account">
              {txn.accountName || "—"}
            </ModalDefinitionRow>
            <ModalDefinitionRow
              label={
                txn.amount < 0 ? "Amount (money out)" : "Amount (money in)"
              }
            >
              {formatAmount(txn.amount)}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Status">
              <Badge
                variant={
                  txn.status === "matched"
                    ? "success"
                    : txn.status === "excluded" || txn.status === "transfer"
                      ? "neutral"
                      : "warning"
                }
              >
                {txn.status === "ready" && txn.postingStatus === "posted" ? "Posted" : STATUS_LABEL[txn.status]}
              </Badge>
            </ModalDefinitionRow>
            {found && (
              <ModalDefinitionRow label={`In ${providerName}`}>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <span className="truncate">
                    Found in {providerName}: {found.label}
                    {found.name ? ` · ${found.name}` : ""} · {found.date}
                  </span>
                  {found.url && (
                    <a href={found.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 text-accent hover:opacity-80" title={`Open in ${providerName}`}>
                      <ExternalLink size={13} strokeWidth={2.25} />
                    </a>
                  )}
                </span>
              </ModalDefinitionRow>
            )}
            {transfer && (
              <ModalDefinitionRow label="Other account">
                {txn.transferAccount || "—"}
              </ModalDefinitionRow>
            )}
          </div>

          {candidates.length > 0 && (
            <section className="flex flex-col gap-[var(--space-sm)] rounded-md border border-status-warning-border bg-status-warning-bg p-[var(--space-sm)]">
              <h3 className="text-body font-bold text-content-primary">Already in {providerName}?</h3>
              <p className="text-body-sm text-content-secondary">
                {candidates.length === 1 ? "This entry" : "These entries"} in {providerName} {candidates.length === 1 ? "has" : "have"} the same amount on this bank account, within 3 days. Pick the one that is this line, so it isn&apos;t entered twice.
              </p>
              <ul className="rounded-md border border-border bg-surface">
                {candidates.map((c) => (
                  <li key={c.key} className="flex items-center gap-[var(--space-sm)] border-b border-border p-[var(--space-sm)] last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">
                        {c.label}
                        {c.name ? ` · ${c.name}` : ""}
                      </span>
                      <span className="block text-caption text-content-secondary">
                        {c.date} · {formatAmount(c.amount)}
                      </span>
                    </span>
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex text-accent hover:opacity-80" title={`Open in ${providerName}`}>
                        <ExternalLink size={14} strokeWidth={2.25} />
                      </a>
                    )}
                    {onLinkFound && (
                      <Button
                        size="sm"
                        onClick={() => {
                          onLinkFound(c.key);
                          onClose();
                        }}
                      >
                        This one
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!inactive && (
            <section className="flex flex-col gap-[var(--space-sm)]">
              <h3 className="text-body font-bold text-content-primary">
                {payBill ? "Pay a bill" : "Match to a bill"}
              </h3>
              {payBill && (
                <p className="text-body-sm text-content-secondary">
                  Accounts Payable means this line pays a bill. Pick the bill below: ScanTrix records a bill payment from this bank account, and no new
                  expense.
                  {visible.length === 0 && (
                    <span className="mt-[var(--space-xs)] block font-semibold text-content-primary">
                      {search.trim() ? `No open bill from ${search.trim()}.` : "No open bill to pay."} Scan the bill first, or choose an expense account.
                    </span>
                  )}
                </p>
              )}
              {matchedInvoice && (
                <p className="text-body-sm text-content-secondary">
                  Matched to {matchedInvoice.vendor} {matchedInvoice.number}.
                </p>
              )}
              {invoices.length === 0 ? (
                <p className="text-body-sm text-content-secondary">
                  No bills available to match yet.
                </p>
              ) : (
                <>
                  <SearchInput
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by vendor or number…"
                    widthClassName="w-full lg:w-full"
                  />
                  <ul className="max-h-52 overflow-y-auto rounded-md border border-border">
                    {visible.length === 0 && (
                      <li className="p-[var(--space-sm)] text-body-sm text-content-secondary">
                        {search ? "No bills match." : "No unpaid bills to match. Bills already paid, or matched to another line, aren't shown."}
                      </li>
                    )}
                    {visible.slice(0, 50).map((c, i) => (
                      <li
                        key={c.id}
                        className="border-b border-border last:border-b-0"
                      >
                        <label className="flex cursor-pointer items-center gap-[var(--space-sm)] p-[var(--space-sm)] hover:bg-surface-alt">
                          <input
                            type="radio"
                            name="invoice"
                            checked={pickedInvoice === c.id}
                            onChange={() => setPickedInvoice(c.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body-sm font-semibold text-content-primary">
                              {c.vendor} {c.number && `· ${c.number}`}
                            </span>
                            <span className="block text-caption text-content-secondary">
                              {c.date || "No date"} · {formatAmount(c.total)}
                            </span>
                          </span>
                          {vendorAgrees(txn, c) && <Badge variant="success">Same vendor</Badge>}
                          {i === 0 &&
                            !search &&
                            (isExactAmount(txn, c) ? (
                              <Badge variant="success">Same amount</Badge>
                            ) : (
                              <Badge>Closest</Badge>
                            ))}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Button
                      size="sm"
                      disabled={!pickedInvoice}
                      onClick={() => {
                        onUpdate(txn.id, {
                          status: "matched",
                          matchedInvoiceId: pickedInvoice,
                        });
                      }}
                    >
                      Match
                    </Button>
                  </div>
                </>
              )}
              <p className="rounded-md border border-dashed border-border px-[var(--space-sm)] py-[var(--space-xs)] text-caption text-content-secondary">
                Entered straight into {providerName}? ScanTrix checks {providerName} every few minutes. When exactly one entry on this bank
                account has the same amount within 3 days, the line moves to Matched by itself. The bank account must be chosen in Connected accounts.
              </p>
            </section>
          )}

          {!inactive && (
            <section className="flex flex-col gap-[var(--space-sm)]">
              <h3 className="text-body font-bold text-content-primary">
                Other actions
              </h3>
              <div className="flex flex-wrap gap-[var(--space-sm)]">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTransferOpen(true)}
                >
                  Mark as transfer between my accounts
                </Button>
              </div>
            </section>
          )}

          {!inactive && (
            <section className="flex flex-col gap-[var(--space-sm)]">
              <h3 className="text-body font-bold text-content-primary">
                Categorise
              </h3>
              {(coding.source !== "none" || suggestion) && (
                <div className="rounded-md border border-border bg-surface-alt p-[var(--space-sm)]">
                  <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
                    <p className="flex min-w-0 flex-1 items-start gap-[var(--space-xs)] text-body-sm text-content-primary">
                      <Sparkles size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-accent" />
                      <span>
                        <span className="font-semibold">
                          {coding.source === "autopilot" ? "Coded by ScanTrix" : pendingSuggestion ? (suggestion?.step === "ai" ? "AI suggestion, please review" : "ScanTrix suggests") : suggestion?.kind === "exclude" ? "Usually excluded" : suggestion?.kind === "transfer" ? "Usually a transfer" : "Not enough history yet"}
                        </span>
                        {offered && codingLabel({ ...offered, source: "none", reason: null, suggestion, offered }, lookups) && <> · {codingLabel({ ...offered, source: "none", reason: null, suggestion, offered }, lookups)}</>}
                        {coding.reason && <span className="block text-caption text-content-secondary">{coding.reason.replace(/^Coded by ScanTrix — /, "")}</span>}
                      </span>
                    </p>
                    {pendingSuggestion && (
                      <Button size="sm" onClick={useSuggestion}>
                        Use this
                      </Button>
                    )}
                    {coding.source === "none" && suggestion?.kind === "exclude" && (
                      <Button size="sm" variant="outline" onClick={() => onUpdate(txn.id, { status: "excluded", matchedInvoiceId: undefined })}>
                        Exclude
                      </Button>
                    )}
                    {coding.source === "none" && suggestion?.kind === "transfer" && suggestion.transferLabel && (
                      <Button size="sm" variant="outline" onClick={() => onUpdate(txn.id, { status: "transfer", transferAccount: suggestion.transferLabel, matchedInvoiceId: undefined })}>
                        Transfer to {suggestion.transferLabel}
                      </Button>
                    )}
                  </div>
                  {suggestion && (
                    <>
                      <button type="button" className="mt-[var(--space-xs)] text-caption font-semibold text-content-secondary underline" onClick={() => setShowChecks((v) => !v)}>
                        {showChecks ? "Hide the checks" : "How ScanTrix decided"}
                      </button>
                      {showChecks && linePicks.length > 0 && (
                        <div className="mt-[var(--space-xs)]">
                          <p className="mb-[var(--space-xs)] text-caption font-semibold text-content-primary">Top accounts for this line</p>
                          <PicksExplained picks={linePicks} />
                        </div>
                      )}
                      {showChecks && (
                        <ul className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-xs)] text-caption text-content-secondary">
                          {(["legibility", "completeness", "history"] as const).map((k) => (
                            <li key={k} className="flex items-start gap-[var(--space-xs)]">
                              {suggestion.checks[k].ok ? (
                                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-status-success-text" />
                              ) : (
                                <CircleDashed size={14} className="mt-0.5 shrink-0" />
                              )}
                              <span>
                                <span className="font-semibold text-content-primary">{k === "legibility" ? "Clean data" : k === "completeness" ? "Complete" : suggestion.step === "similar" ? "Similar past items" : suggestion.step === "ai" ? "AI suggestion" : "Matches your history"}: </span>
                                {suggestion.checks[k].detail}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
              <CreatableCombobox
                options={vendorOptions}
                noun="vendor"
                ariaLabel="Vendor"
                value={txn.vendorId ?? ""}
                onSelect={(id) => {
                  const v = lookups.vendorById.get(id);
                  if (v) setPayee(v.displayName);
                  onUpdate(txn.id, {
                    vendorId: id || undefined,
                    ...(v ? { payee: v.displayName } : {}),
                    // A vendor's own defaults fill only what is still empty.
                    ...(v?.glAccountId && !txn.categoryId ? { categoryId: v.glAccountId } : {}),
                    ...(v?.taxCodeId && !txn.taxCodeId ? { taxCodeId: v.taxCodeId } : {}),
                  });
                }}
                clearLabel="No vendor"
                placeholder="Vendor"
                uiSize="md"
                // One vendor box, like the invoice screen (Saurabh, 18 Nov).
                suggestedNew={newVendorName}
                onAddNew={(name) => setAddingVendor(name || newVendorName)}
              />
              <CreatableCombobox
                options={glOptions}
                noun="GL account"
                ariaLabel="GL account"
                value={txn.categoryId ?? ""}
                onSelect={(id) => {
                  if (id && glChoices.find((c) => c.id === id)?.kind === "payable") {
                    if (txn.amount > 0) return;
                    setPayBill(true);
                    setSearch(payBillSearch(txn, lookups));
                    return;
                  }
                  // Tax is the vendor's saved tax code, never the account's usual one (18 Nov).
                  onUpdate(txn.id, { categoryId: id || undefined });
                }}
                footerAction={onRefreshAccounts ? { label: "Missing an account? Refresh the list", onClick: onRefreshAccounts } : undefined}
                picks={linePicks.map((p) => ({ id: p.pick.glAccountId, reason: p.reason, badge: <ConfidenceLabel level={p.pick.confidence} ai={p.pick.step === "ai"} /> }))}
                clearLabel="No category"
                placeholder="GL account"
                uiSize="md"
              />
              {taxOptions.length > 0 && (
                <CreatableCombobox
                  options={taxOptions}
                  noun="tax code"
                  ariaLabel="Tax code"
                  value={txn.taxCodeId ?? ""}
                  onSelect={(id) => onUpdate(txn.id, { taxCodeId: id || undefined })}
                  clearLabel="No tax code"
                  placeholder="Tax code"
                  uiSize="md"
                />
              )}
              <div className="flex flex-wrap gap-[var(--space-sm)]">
                <Button
                  size="sm"
                  disabled={!coding.glAccountId}
                  title={coding.glAccountId ? undefined : "Pick a GL account first"}
                  onClick={() => {
                    const vendorName = coding.vendorId ? lookups.vendorById.get(coding.vendorId)?.displayName : undefined;
                    const patch: Partial<BankTransaction> = {
                      status: "ready",
                      vendorId: coding.vendorId,
                      categoryId: coding.glAccountId,
                      taxCodeId: coding.taxCodeId,
                      payee: payee.trim() || coding.payee || vendorName,
                    };
                    if (onPost) onPost(patch);
                    else onUpdate(txn.id, patch);
                    onClose();
                  }}
                >
                  Post
                </Button>
              </div>
            </section>
          )}
        </div>
      </Modal>
      {transferOpen && (
        <TransferModal
          txn={txn}
          bankAccounts={bankAccounts}
          onClose={() => setTransferOpen(false)}
          onSave={(counterpart) => {
            onUpdate(txn.id, {
              status: "transfer",
              transferAccount: counterpart,
              matchedInvoiceId: undefined,
            });
            setTransferOpen(false);
          }}
        />
      )}
      <AddVendorModalV2
        open={addingVendor !== null}
        onClose={() => setAddingVendor(null)}
        initialName={vendorDefaults.name}
        initialGlAccountId={vendorDefaults.glAccountId}
        initialTaxCodeId={vendorDefaults.taxCodeId}
        initialCurrency={vendorDefaults.currency}
        onCreated={(vendor) => {
          setPayee(vendor.displayName);
          onUpdate(txn.id, newVendorPatch(vendor, coding));
        }}
      />
    </>
  );
}
