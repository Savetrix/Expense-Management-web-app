"use client";

import { CheckCircle2, CircleDashed, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  CreatableCombobox,
  Modal,
  ModalDefinitionRow,
  SearchInput,
  TextInput,
} from "@/components/v2/ui";
import { taxCodeId, taxCodeLabel } from "@/lib/quickbooks/taxCode";

import { codingFor, codingLabel, type Lookups } from "./coding";
import { formatAmount } from "./format";
import { isExactAmount, rankInvoices } from "./matching";
import { TransferModal } from "./TransferModal";
import type { BankAccount, BankTransaction, InvoiceCandidate } from "./types";

interface TransactionModalProps {
  txn: BankTransaction | null;
  invoices: InvoiceCandidate[];
  lookups: Lookups;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<BankTransaction>) => void;
  /** Open on the transfer form instead of the details (the row's transfer button). */
  initialFocus?: "match" | "transfer";
  providerName?: string;
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
  lookups,
  bankAccounts,
  onClose,
  onUpdate,
  initialFocus,
  providerName = "QuickBooks",
}: TransactionModalProps) {
  const [transferOpen, setTransferOpen] = useState(initialFocus === "transfer");
  const [search, setSearch] = useState("");
  const [pickedInvoice, setPickedInvoice] = useState("");
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [showChecks, setShowChecks] = useState(false);

  const ranked = useMemo(
    () => (txn ? rankInvoices(txn, invoices) : []),
    [txn, invoices],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? ranked.filter((c) =>
          `${c.vendor} ${c.number}`.toLowerCase().includes(q),
        )
      : ranked;
  }, [ranked, search]);
  const glOptions = useMemo(() => lookups.glAccounts.map((a) => ({ id: a.qbAccountId, label: a.name })), [lookups.glAccounts]);
  const vendorOptions = useMemo(() => lookups.vendors.map((v) => ({ id: v._id, label: v.displayName })), [lookups.vendors]);
  const taxOptions = useMemo(() => lookups.taxCodes.map((t) => ({ id: taxCodeId(t), label: taxCodeLabel(t) })), [lookups.taxCodes]);

  if (!txn) return null;
  const excluded = txn.status === "excluded";
  const transfer = txn.status === "transfer";
  const ready = txn.status === "ready";
  const inactive = excluded || transfer || ready;
  const matchedInvoice = invoices.find((c) => c.id === txn.matchedInvoiceId);
  const coding = codingFor(txn);
  const suggestion = coding.suggestion;
  const pendingSuggestion = coding.source === "suggested";
  const useSuggestion = () => {
    const vendorName = coding.vendorId ? lookups.vendorById.get(coding.vendorId)?.displayName : undefined;
    const nextPayee = coding.payee ?? vendorName;
    if (nextPayee) setPayee(nextPayee);
    onUpdate(txn.id, { vendorId: coding.vendorId, categoryId: coding.glAccountId, taxCodeId: coding.taxCodeId, payee: nextPayee });
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
            {excluded || ready ? (
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
                {STATUS_LABEL[txn.status]}
              </Badge>
            </ModalDefinitionRow>
            {transfer && (
              <ModalDefinitionRow label="Other account">
                {txn.transferAccount || "—"}
              </ModalDefinitionRow>
            )}
          </div>

          {!inactive && (
            <section className="flex flex-col gap-[var(--space-sm)]">
              <h3 className="text-body font-bold text-content-primary">
                Match to a bill
              </h3>
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
                        No bills match.
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
                Entered straight into {providerName}? Searching {providerName} for bills and expenses that didn&apos;t come through Scantrix
                isn&apos;t switched on yet (BE).
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
                          {coding.source === "autopilot" ? "Coded by Scantrix" : pendingSuggestion ? "Scantrix suggests" : suggestion?.kind === "exclude" ? "Usually excluded" : suggestion?.kind === "transfer" ? "Usually a transfer" : "Not enough history yet"}
                        </span>
                        {pendingSuggestion && codingLabel(coding, lookups) && <> · {codingLabel(coding, lookups)}</>}
                        {coding.reason && <span className="block text-caption text-content-secondary">{coding.reason.replace(/^Coded by Scantrix — /, "")}</span>}
                      </span>
                    </p>
                    {pendingSuggestion && (
                      <Button size="sm" onClick={useSuggestion}>
                        Use suggestion
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
                        {showChecks ? "Hide the checks" : "How Scantrix decided"}
                      </button>
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
                                <span className="font-semibold text-content-primary">{k === "legibility" ? "Clean data" : k === "completeness" ? "Complete" : "Matches your history"}: </span>
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
              />
              <CreatableCombobox
                options={glOptions}
                noun="GL account"
                ariaLabel="GL account"
                value={txn.categoryId ?? ""}
                onSelect={(id) => onUpdate(txn.id, { categoryId: id || undefined })}
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
              <TextInput
                label="Vendor / payee"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                onBlur={() =>
                  onUpdate(txn.id, { payee: payee.trim() || undefined })
                }
                placeholder="Who was paid or who paid you"
              />
              <div>
                <Button
                  size="sm"
                  disabled={!coding.glAccountId}
                  title={coding.glAccountId ? undefined : "Pick a GL account first"}
                  onClick={() => {
                    const vendorName = coding.vendorId ? lookups.vendorById.get(coding.vendorId)?.displayName : undefined;
                    onUpdate(txn.id, {
                      status: "ready",
                      vendorId: coding.vendorId,
                      categoryId: coding.glAccountId,
                      taxCodeId: coding.taxCodeId,
                      payee: payee.trim() || coding.payee || vendorName,
                    });
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
    </>
  );
}
