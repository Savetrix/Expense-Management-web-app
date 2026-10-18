"use client";

import { BellRing, CheckCircle2, Mail, Plus, Receipt, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { Modal, ModalDefinitionRow, RoleInfoBanner } from "@/components/v2/ui";
import { BE_SUFFIX, beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import {
  FIELD_INPUT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_TEXTAREA_CLASS,
  formatDate,
  formatSlotDate,
  money,
  reminderSchedule,
} from "./format";
import {
  REQUEST_TYPES,
  requestTypeLabel,
  ymdOffset,
  type PaperworkRequest,
  type RequestItem,
  type RequestType,
} from "./types";

export interface RequestPrefill {
  vendor?: string;
  item?: string;
  amount?: number;
  date?: string;
}

interface DraftItem {
  id: string;
  description: string;
  amount: string;
  date: string;
}

type Step = 1 | 2 | 3 | "sent";

const STEP_TITLES: Record<1 | 2 | 3, string> = { 1: "What's needed", 2: "Who & when", 3: "Review" };
// Item-row inputs: same field styling, compact height, no top margin.
const ITEM_INPUT_CLASS = FIELD_INPUT_CLASS.replace("mt-[var(--space-xs)] h-[50px]", "h-11");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let draftSeq = 0;
const newDraftItem = (patch: Partial<DraftItem> = {}): DraftItem => ({
  id: `d-${++draftSeq}`,
  description: "",
  amount: "",
  date: "",
  ...patch,
});

interface NewRequestWizardProps {
  prefill: RequestPrefill | null;
  onClose: () => void;
  onSend: (request: PaperworkRequest) => void;
  onView: (id: string) => void;
}

export function NewRequestWizard({ prefill, onClose, onSend, onView }: NewRequestWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<RequestType>(prefill ? "missing_invoices" : "card_receipts");
  const [title, setTitle] = useState(
    prefill?.vendor ? `Missing invoices from ${prefill.vendor}` : REQUEST_TYPES.find((t) => t.value === "card_receipts")!.defaultTitle,
  );
  const [titleTouched, setTitleTouched] = useState(Boolean(prefill?.vendor));
  const [items, setItems] = useState<DraftItem[]>(() =>
    prefill?.item
      ? [newDraftItem({ description: prefill.item, amount: prefill.amount ? String(prefill.amount) : "", date: prefill.date ?? "" })]
      : [],
  );
  const [assigneeEmail, setAssigneeEmail] = useState("");
  const [assigneeName, setAssigneeName] = useState(prefill?.vendor ?? "");
  const [dueDate, setDueDate] = useState(ymdOffset(14));
  const [message, setMessage] = useState("");
  const [remindersOn, setRemindersOn] = useState(true);
  const [error, setError] = useState("");
  const [sentId, setSentId] = useState("");

  const filledItems = items.filter((i) => i.description.trim());
  const itemCount = filledItems.length;
  const schedule = useMemo(() => reminderSchedule(dueDate), [dueDate]);
  const activeReminders = schedule.filter((s) => !s.skipped);
  const showTransactions = type !== "bank_statement";

  const changeType = (next: RequestType) => {
    setType(next);
    if (!titleTouched) setTitle(REQUEST_TYPES.find((t) => t.value === next)?.defaultTitle ?? "");
  };

  const updateItem = (id: string, patch: Partial<DraftItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const next = () => {
    if (step === 1) {
      if (!title.trim()) return setError("Give the request a title.");
      if (itemCount === 0) return setError("Add at least one item.");
      setError("");
      setStep(2);
    } else if (step === 2) {
      if (!EMAIL_RE.test(assigneeEmail.trim())) return setError("Enter a valid email address for the recipient.");
      if (!dueDate) return setError("Pick a due date.");
      if (dueDate < ymdOffset(1)) return setError("The due date needs to be after today.");
      setError("");
      setStep(3);
    }
  };

  const back = () => {
    setError("");
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const send = () => {
    notifyBackendPending("Send request");
    const now = new Date().toISOString();
    const id = `rq-${Date.now()}`;
    const requestItems: RequestItem[] = [
      ...filledItems.map((i, idx) => ({
        id: `i-${idx + 1}`,
        description: i.description.trim(),
        amount: i.amount ? Number(i.amount) : undefined,
        date: i.date || undefined,
        status: "waiting" as const,
      })),
    ];
    const email = assigneeEmail.trim();
    onSend({
      id,
      title: title.trim(),
      type,
      assigneeName: assigneeName.trim() || email,
      assigneeEmail: email,
      dueDate,
      sentAt: now,
      message: message.trim(),
      remindersOn,
      status: "open",
      items: requestItems,
      activity: [{ id: "a-1", at: now, kind: "sent", text: `Request emailed to ${email}${remindersOn ? "" : " (reminders off)"}` }],
    });
    setSentId(id);
    setStep("sent");
  };

  const greeting = assigneeName.trim() ? `Hi ${assigneeName.trim().split(" ")[0]},` : "Hi,";

  const footer =
    step === "sent" ? (
      <>
        <Button variant="outline" size="sm" onClick={() => onView(sentId)}>
          View request
        </Button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </>
    ) : (
      <>
        <Button variant="outline" size="sm" onClick={step === 1 ? onClose : back}>
          {step === 1 ? "Cancel" : "Back"}
        </Button>
        {step === 3 ? (
          <Button size="sm" onClick={send}>
            <Mail size={16} strokeWidth={2.25} />
            {beLabel("Send request")}
          </Button>
        ) : (
          <Button size="sm" onClick={next}>
            Next
          </Button>
        )}
      </>
    );

  return (
    <Modal open onClose={onClose} title={step === "sent" ? "Request sent" : "New request"} widthClassName="max-w-2xl" footer={footer}>
      {step !== "sent" && (
        <div className="mb-[var(--space-md)]">
          <div className="flex gap-[var(--space-xs)]">
            {[1, 2, 3].map((n) => (
              <span key={n} className={`h-1.5 flex-1 rounded-pill ${n <= step ? "bg-accent" : "bg-chart-4"}`} />
            ))}
          </div>
          <p className="mt-[var(--space-xs)] text-caption font-semibold text-content-secondary">
            Step {step} of 3 · {STEP_TITLES[step]}
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div>
            <p className={FIELD_LABEL_CLASS}>Request type</p>
            <div role="radiogroup" className="mt-[var(--space-xs)] grid grid-cols-1 gap-[var(--space-xs)] sm:grid-cols-2">
              {REQUEST_TYPES.map((t) => {
                const active = t.value === type;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => changeType(t.value)}
                    className={`flex items-center gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] text-left text-body-sm font-semibold transition-colors ${
                      active ? "border-accent bg-accent/10 text-content-primary" : "border-border bg-surface text-content-primary hover:bg-surface-alt"
                    }`}
                  >
                    <span aria-hidden className={`h-4 w-4 shrink-0 rounded-full border-2 ${active ? "border-accent bg-accent" : "border-border-strong"}`} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL_CLASS} htmlFor="request-title">
              Title *
            </label>
            <input
              id="request-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              placeholder="e.g. Receipts for September card spend"
              className={FIELD_INPUT_CLASS}
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-[var(--space-sm)]">
              <p className={FIELD_LABEL_CLASS}>Items</p>
              <button type="button" onClick={() => setItems((list) => [...list, newDraftItem()])} className="flex items-center gap-[var(--space-xs)] text-body-sm font-bold text-accent hover:underline">
                <Plus size={14} strokeWidth={2.5} />
                Add item
              </button>
            </div>
            {items.length === 0 ? (
              <p className="mt-[var(--space-xs)] text-caption text-content-secondary">
                {type === "bank_statement"
                  ? "Add a row per statement, e.g. “Operating account, September”."
                  : "Add a row per document you need."}
              </p>
            ) : (
              <div className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-sm)]">
                {items.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_1fr_auto] gap-[var(--space-xs)] rounded-md border border-border p-[var(--space-sm)] sm:grid-cols-[1fr_120px_150px_auto] sm:border-0 sm:p-0">
                    <input
                      aria-label="Description"
                      value={item.description}
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      placeholder={type === "bank_statement" ? "Account and month" : "Description or invoice number"}
                      className={`${ITEM_INPUT_CLASS} col-span-2 sm:col-span-1`}
                    />
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))}
                      className="flex h-11 w-11 items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt sm:order-last"
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                    <input
                      aria-label="Amount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => updateItem(item.id, { amount: e.target.value })}
                      placeholder="Amount"
                      className={ITEM_INPUT_CLASS}
                    />
                    <input
                      aria-label="Date"
                      type="date"
                      value={item.date}
                      onChange={(e) => updateItem(item.id, { date: e.target.value })}
                      className={ITEM_INPUT_CLASS}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {showTransactions && (
            <div>
              <p className={FIELD_LABEL_CLASS}>Transactions missing paperwork</p>
              {/* No real source yet: the backend (BE) lists bank and card
                  transactions without a matching document. */}
              <div className="mt-[var(--space-xs)] rounded-md border border-border">
                <EmptyState
                  icon={<Receipt size={28} strokeWidth={1.75} />}
                  title="No transactions to pick from"
                  description={`Transactions missing paperwork load from the backend ${BE_SUFFIX}. Add items manually above in the meantime.`}
                />
              </div>
            </div>
          )}

          <p className="text-caption text-content-secondary">
            {itemCount} item{itemCount === 1 ? "" : "s"} in this request
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
          <div>
            <label className={FIELD_LABEL_CLASS} htmlFor="assignee-email">
              Recipient email *
            </label>
            <input
              id="assignee-email"
              type="email"
              value={assigneeEmail}
              onChange={(e) => setAssigneeEmail(e.target.value)}
              placeholder="name@company.com"
              className={FIELD_INPUT_CLASS}
            />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS} htmlFor="assignee-name">
              Recipient name
            </label>
            <input
              id="assignee-name"
              value={assigneeName}
              onChange={(e) => setAssigneeName(e.target.value)}
              placeholder="Optional"
              className={FIELD_INPUT_CLASS}
            />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS} htmlFor="due-date">
              Due date *
            </label>
            <input id="due-date" type="date" min={ymdOffset(1)} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={FIELD_INPUT_CLASS} />
          </div>
          <div className="sm:col-span-2">
            <label className={FIELD_LABEL_CLASS} htmlFor="request-message">
              Message (optional)
            </label>
            <textarea
              id="request-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a note that appears at the top of the email"
              className={FIELD_TEXTAREA_CLASS}
            />
          </div>
          <div className="sm:col-span-2">
            <RoleInfoBanner>
              The recipient simply replies to the email with attachments — no Scantrix account or login needed. Each document is
              matched to its item automatically.
            </RoleInfoBanner>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div className="rounded-md border border-border px-[var(--space-md)]">
            <ModalDefinitionRow label="Type">{requestTypeLabel(type)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Items">{itemCount}</ModalDefinitionRow>
            <ModalDefinitionRow label="To">
              <span className="truncate">{assigneeName.trim() ? `${assigneeName.trim()} · ${assigneeEmail.trim()}` : assigneeEmail.trim()}</span>
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Due">{formatDate(dueDate)}</ModalDefinitionRow>
          </div>

          <div>
            <p className={FIELD_LABEL_CLASS}>Email preview</p>
            <div className="mt-[var(--space-xs)] rounded-md border border-border bg-page p-[var(--space-md)] text-body-sm text-content-primary">
              <p className="text-caption text-content-secondary">
                Subject: <span className="font-semibold text-content-primary">Paperwork needed: {title.trim()}</span>
              </p>
              <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-sm)] border-t border-border pt-[var(--space-sm)]">
                <p>{greeting}</p>
                {message.trim() && <p className="whitespace-pre-line">{message.trim()}</p>}
                <p>
                  We need the following by <strong>{formatDate(dueDate)}</strong>:
                </p>
                <ul className="list-disc pl-[var(--space-lg)]">
                  {filledItems.map((i) => (
                    <li key={i.id}>
                      {i.description.trim()}
                      {i.amount ? ` · ${money(Number(i.amount))}` : ""}
                      {i.date ? ` · ${formatDate(i.date)}` : ""}
                    </li>
                  ))}
                </ul>
                <p>Just reply to this email with the documents attached — no login needed. Thank you!</p>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border p-[var(--space-md)]">
            <div className="flex items-center justify-between gap-[var(--space-md)]">
              <span className="flex items-center gap-[var(--space-sm)]">
                <BellRing size={18} strokeWidth={2} className="shrink-0 text-content-secondary" />
                <span>
                  <span className="block text-body-sm font-semibold text-content-primary">Automatic reminders</span>
                  <span className="block text-caption text-content-secondary">
                    {remindersOn
                      ? `${activeReminders.length} reminder${activeReminders.length === 1 ? "" : "s"} until everything is received`
                      : "Off — you can still send a reminder manually"}
                  </span>
                </span>
              </span>
              <Switch checked={remindersOn} onChange={setRemindersOn} label="Automatic reminders" />
            </div>
            {remindersOn && (
              <ul className="mt-[var(--space-sm)] grid grid-cols-1 gap-x-[var(--space-md)] gap-y-[var(--space-xs)] border-t border-border pt-[var(--space-sm)] sm:grid-cols-2">
                {schedule.map((slot) => (
                  <li key={slot.label} className={`flex justify-between gap-[var(--space-sm)] text-caption ${slot.skipped ? "text-content-muted line-through" : "text-content-primary"}`}>
                    <span>{slot.label}</span>
                    <span className="shrink-0 font-semibold">{formatSlotDate(slot.date)}</span>
                  </li>
                ))}
              </ul>
            )}
            {remindersOn && schedule.some((s) => s.skipped) && (
              <p className="mt-[var(--space-xs)] text-tiny text-content-muted">Crossed-out reminders fall before the send date and are skipped.</p>
            )}
          </div>
        </div>
      )}

      {step === "sent" && (
        <div className="flex flex-col items-center py-[var(--space-lg)] text-center">
          <span className="mb-[var(--space-md)] flex h-16 w-16 items-center justify-center rounded-full bg-accent-bg text-accent-text-on-bg">
            <CheckCircle2 size={30} strokeWidth={1.75} />
          </span>
          <p className="text-h3 font-bold text-content-primary">Request sent to {assigneeName.trim() || assigneeEmail.trim()}</p>
          <p className="mt-[var(--space-xs)] max-w-sm text-body-sm text-content-secondary">
            {remindersOn
              ? `We'll chase it with up to ${activeReminders.length} reminders and match replies to the ${itemCount} item${itemCount === 1 ? "" : "s"} automatically.`
              : `Reminders are off. Replies are still matched to the ${itemCount} item${itemCount === 1 ? "" : "s"} automatically.`}
          </p>
        </div>
      )}

      {error && <p className="mt-[var(--space-md)] text-caption font-semibold text-status-danger-text">{error}</p>}
    </Modal>
  );
}
