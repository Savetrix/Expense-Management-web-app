"use client";

import { useRouter } from "next/navigation";
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
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import type { GLAccount } from "@/store/quickBooks/quickBooksSlice";

import { formatAmount } from "./format";
import { isExactAmount, paperworkHref, rankInvoices } from "./matching";
import { TransferModal } from "./TransferModal";
import type { BankAccount, BankTransaction, InvoiceCandidate } from "./types";

interface TransactionModalProps {
  txn: BankTransaction | null;
  invoices: InvoiceCandidate[];
  glAccounts: GLAccount[];
  bankAccounts: BankAccount[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<BankTransaction>) => void;
}

export const STATUS_LABEL: Record<BankTransaction["status"], string> = {
  review: "To review",
  matched: "Matched",
  excluded: "Excluded",
  transfer: "Transfer",
};

export function TransactionModal({
  txn,
  invoices,
  glAccounts,
  bankAccounts,
  onClose,
  onUpdate,
}: TransactionModalProps) {
  const router = useRouter();
  const [transferOpen, setTransferOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedInvoice, setPickedInvoice] = useState("");
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [categoryId, setCategoryId] = useState(txn?.categoryId ?? "");

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
  const glOptions = useMemo(
    () =>
      glAccounts
        .filter((a) => !a.isDeleted)
        .map((a) => ({ id: a._id, label: a.name })),
    [glAccounts],
  );

  if (!txn) return null;
  const excluded = txn.status === "excluded";
  const transfer = txn.status === "transfer";
  const inactive = excluded || transfer;
  const matchedInvoice = invoices.find((c) => c.id === txn.matchedInvoiceId);

  return (
    <>
      <Modal
        open={!transferOpen}
        onClose={onClose}
        title="Transaction"
        widthClassName="max-w-xl"
        footer={
          <>
            {excluded ? (
              <Button
                variant="outline"
                onClick={() => onUpdate(txn.id, { status: "review" })}
              >
                Restore
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
                {txn.amount < 0 &&
                  txn.status === "review" &&
                  !txn.matchedInvoiceId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(paperworkHref(txn))}
                    >
                      Ask for the invoice
                    </Button>
                  )}
              </div>
            </section>
          )}

          {!inactive && (
            <section className="flex flex-col gap-[var(--space-sm)]">
              <h3 className="text-body font-bold text-content-primary">
                Categorise
              </h3>
              <CreatableCombobox
                options={glOptions}
                noun="GL account"
                ariaLabel="GL account"
                value={categoryId}
                onSelect={(id) => {
                  setCategoryId(id);
                  onUpdate(txn.id, { categoryId: id || undefined });
                }}
                clearLabel="No category"
                uiSize="md"
              />
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
                  variant="outline"
                  onClick={() =>
                    notifyBackendPending("Create bill/expense from this")
                  }
                >
                  {beLabel("Create bill/expense from this")}
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
