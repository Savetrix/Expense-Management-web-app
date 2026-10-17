"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { BalanceSheetAccount, LineItem, SupportItem } from "./mockData";
import { newId } from "./mockData";
import { JustificationModal } from "./JustificationModal";
import { FIELD_INPUT_CLASS, FIELD_LABEL_CLASS, FILE_INPUT_CLASS, money, round2, signOffText } from "./closeShared";

export interface AccountDraft {
  lineItems: LineItem[];
  supports: SupportItem[];
}

interface AccountReconcileModalProps {
  account: BalanceSheetAccount | null;
  onClose: () => void;
  onSave: (accountId: string, draft: AccountDraft) => void;
  onReconcile: (accountId: string, draft: AccountDraft, justification?: string) => void;
  onUnreconcile: (accountId: string) => void;
}

// Reconciles one balance-sheet account: carried-forward line items plus
// any support added this period must explain the balance in the ledger.
export function AccountReconcileModal({ account, ...rest }: AccountReconcileModalProps) {
  // The justification dialog is rendered beside (not inside) the account
  // modal: the modal backdrop's blur creates a containing block that would
  // trap a nested fixed overlay inside the panel.
  const [pending, setPending] = useState<{ draft: AccountDraft; difference: number } | null>(null);
  return (
    <>
      <Modal
        open={!!account}
        onClose={rest.onClose}
        title={account ? `${account.code} · ${account.name}` : "Account"}
        widthClassName="max-w-2xl"
      >
        {account && (
          <AccountBody
            key={account.id + (account.reconciled?.at ?? "")}
            account={account}
            onRequestJustification={(draft, difference) => setPending({ draft, difference })}
            {...rest}
          />
        )}
      </Modal>
      <JustificationModal
        open={!!pending && !!account}
        subject={account?.name ?? ""}
        difference={pending?.difference ?? 0}
        onCancel={() => setPending(null)}
        onConfirm={(text) => {
          if (account && pending) rest.onReconcile(account.id, pending.draft, text);
          setPending(null);
        }}
      />
    </>
  );
}

type AccountBodyProps = { account: BalanceSheetAccount; onRequestJustification: (draft: AccountDraft, difference: number) => void } & Omit<
  AccountReconcileModalProps,
  "account"
>;

function AccountBody({ account, onClose, onSave, onReconcile, onUnreconcile, onRequestJustification }: AccountBodyProps) {
  const provider = useActiveProvider();
  const [lineItems, setLineItems] = useState<LineItem[]>(account.lineItems);
  const [supports, setSupports] = useState<SupportItem[]>(account.supports);
  const [newLine, setNewLine] = useState({ description: "", amount: "" });
  const [supportForm, setSupportForm] = useState<{ open: boolean; amount: string; note: string; attachmentName?: string }>({ open: false, amount: "", note: "" });
  const [formError, setFormError] = useState("");

  const locked = Boolean(account.reconciled);
  const supportBalance = lineItems.reduce((s, l) => s + l.amount, 0) + supports.reduce((s, x) => s + x.amount, 0);
  const difference = round2(account.ledgerBalance - supportBalance);
  const draft: AccountDraft = { lineItems, supports };

  const addLine = () => {
    const amount = Number(newLine.amount);
    if (!newLine.description.trim() || newLine.amount.trim() === "" || Number.isNaN(amount)) {
      setFormError("Enter a description and an amount for the line item.");
      return;
    }
    setLineItems((items) => [...items, { id: newId("li"), description: newLine.description.trim(), amount }]);
    setNewLine({ description: "", amount: "" });
    setFormError("");
  };

  const addSupport = () => {
    const amount = Number(supportForm.amount);
    if (supportForm.amount.trim() === "" || Number.isNaN(amount) || !supportForm.note.trim()) {
      setFormError("Support needs an amount and a note.");
      return;
    }
    setSupports((items) => [...items, { id: newId("sup"), amount, note: supportForm.note.trim(), attachmentName: supportForm.attachmentName }]);
    setSupportForm({ open: false, amount: "", note: "" });
    setFormError("");
  };

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      {locked && account.reconciled && (
        <div className="flex flex-col gap-[var(--space-sm)] rounded-md border border-border bg-page p-[var(--space-md)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
              <Badge variant="success">Reconciled</Badge>
              <span className="text-caption text-content-secondary">{signOffText("Reconciled", account.reconciled)}</span>
            </div>
            {account.reconciled.justification && (
              <p className="mt-[var(--space-xs)] text-body-sm text-content-primary">Justification: {account.reconciled.justification}</p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => onUnreconcile(account.id)}>
            {beLabel("Undo reconciliation")}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-3">
        <Stat label={`Per ${provider.name}`} value={money(account.ledgerBalance)} />
        <Stat label="Per support" value={money(supportBalance)} />
        <Stat label="Difference" value={money(difference)} danger={difference !== 0} />
      </div>

      <div>
        <h3 className="text-body font-semibold text-content-primary">Line items</h3>
        <p className="text-caption text-content-secondary">Line items carry forward into the next period&apos;s working paper.</p>
        <ul className="mt-[var(--space-sm)] divide-y divide-border rounded-md border border-border">
          {lineItems.length === 0 && <li className="px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-content-secondary">No line items yet.</li>}
          {lineItems.map((li) => (
            <li key={li.id} className="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
              <span className="min-w-0 truncate text-body-sm text-content-primary">{li.description}</span>
              <span className="flex shrink-0 items-center gap-[var(--space-sm)]">
                <span className="text-body-sm font-semibold text-content-primary">{money(li.amount)}</span>
                {!locked && (
                  <button
                    type="button"
                    aria-label={`Remove ${li.description}`}
                    onClick={() => setLineItems((items) => items.filter((x) => x.id !== li.id))}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt"
                  >
                    <Trash2 size={16} strokeWidth={2} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!locked && (
          <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-sm)] sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="li-desc" className={FIELD_LABEL_CLASS}>Description</label>
              <input id="li-desc" value={newLine.description} onChange={(e) => setNewLine((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Statement closing balance" className={FIELD_INPUT_CLASS} />
            </div>
            <div className="sm:w-40">
              <label htmlFor="li-amount" className={FIELD_LABEL_CLASS}>Amount</label>
              <input id="li-amount" type="number" step="0.01" value={newLine.amount} onChange={(e) => setNewLine((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" className={FIELD_INPUT_CLASS} />
            </div>
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus size={16} strokeWidth={2.5} />
              Add line
            </Button>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-[var(--space-sm)]">
          <h3 className="text-body font-semibold text-content-primary">Support</h3>
          {!locked && !supportForm.open && (
            <Button size="sm" variant="outline" onClick={() => setSupportForm((f) => ({ ...f, open: true }))}>
              <Plus size={16} strokeWidth={2.5} />
              Add support
            </Button>
          )}
        </div>
        {supports.length > 0 && (
          <ul className="mt-[var(--space-sm)] divide-y divide-border rounded-md border border-border">
            {supports.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
                <span className="min-w-0">
                  <span className="block truncate text-body-sm text-content-primary">{s.note}</span>
                  {s.attachmentName && <span className="block truncate text-caption text-content-secondary">{s.attachmentName}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-[var(--space-sm)]">
                  <span className="text-body-sm font-semibold text-content-primary">{money(s.amount)}</span>
                  {!locked && (
                    <button
                      type="button"
                      aria-label="Remove support"
                      onClick={() => setSupports((items) => items.filter((x) => x.id !== s.id))}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt"
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {supports.length === 0 && !supportForm.open && <p className="mt-[var(--space-xs)] text-caption text-content-secondary">No support added this period.</p>}
        {supportForm.open && (
          <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-sm)] rounded-md border border-border bg-page p-[var(--space-md)]">
            <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-3">
              <div>
                <label htmlFor="sup-amount" className={FIELD_LABEL_CLASS}>Amount *</label>
                <input id="sup-amount" type="number" step="0.01" value={supportForm.amount} onChange={(e) => setSupportForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" className={FIELD_INPUT_CLASS} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="sup-note" className={FIELD_LABEL_CLASS}>Note *</label>
                <input id="sup-note" value={supportForm.note} onChange={(e) => setSupportForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. Unpresented cheque 10442" className={FIELD_INPUT_CLASS} />
              </div>
            </div>
            <div>
              <label htmlFor="sup-file" className={FIELD_LABEL_CLASS}>Attachment (optional)</label>
              <input id="sup-file" type="file" onChange={(e) => setSupportForm((f) => ({ ...f, attachmentName: e.target.files?.[0]?.name }))} className={FILE_INPUT_CLASS} />
            </div>
            <div className="flex justify-end gap-[var(--space-sm)]">
              <Button size="sm" variant="outline" onClick={() => setSupportForm({ open: false, amount: "", note: "" })}>Cancel</Button>
              <Button size="sm" onClick={addSupport}>Add</Button>
            </div>
          </div>
        )}
      </div>

      {formError && <p className="text-caption font-semibold text-status-danger-text">{formError}</p>}

      <div className="flex flex-col-reverse gap-[var(--space-sm)] border-t border-border pt-[var(--space-md)] sm:flex-row sm:justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          {locked ? "Close" : "Cancel"}
        </Button>
        {!locked && (
          <>
            <Button variant="outline" size="sm" onClick={() => onSave(account.id, draft)}>
              {beLabel("Save")}
            </Button>
            {difference === 0 ? (
              <Button size="sm" onClick={() => onReconcile(account.id, draft)}>
                {beLabel("Reconcile")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => onRequestJustification(draft, difference)}>
                Reconcile with difference
              </Button>
            )}
          </>
        )}
      </div>

    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
      <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">{label}</p>
      <p className={`text-body font-bold ${danger ? "text-status-danger-text" : "text-content-primary"}`}>{value}</p>
    </div>
  );
}
