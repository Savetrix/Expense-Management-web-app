"use client";

import { AlertCircle, Inbox, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { CreatableCombobox, Modal, ModalDefinitionRow, ProgressBar } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  createExpenseClaim,
  deleteClaimReceipt,
  fetchClaimReceipts,
  uploadClaimReceipts,
  type ClaimContactDto,
  type ClaimableReceiptDto,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";

import {
  FIELD_LABEL_CLASS,
  errorMessage,
  isApprover,
  money,
  monthLabel,
  shortDate,
  todayIso,
  type CompanyRole,
} from "./shared";
import type { TeamPerson } from "./useTeamMembers";
import { ApproverNotice, useApproverPreview } from "./ApproverNotice";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

interface NewClaimWizardProps {
  open: boolean;
  onClose: () => void;
  members: TeamPerson[];
  /** Claimants outside the team from earlier claims. */
  contacts: ClaimContactDto[];
  role: CompanyRole;
  selfId: string;
  onCreated: () => void;
}

type Step = 1 | 2 | 3;
const STEP_TITLES: Record<Step, string> = { 1: "Add receipts", 2: "Choose approver", 3: "Review & send" };

// Picker ids: a team member is their userId; a saved contact and a name typed
// just now get these prefixes. A typed name becomes a contact on the server.
const NAME_PREFIX = "name:";
const CONTACT_PREFIX = "contact:";

// Same limit as the dashboard's scanner (the backend takes 10 files per upload).
const MAX_UPLOAD_FILES = 10;
// A scan usually takes well under a minute; check back this often meanwhile.
const POLL_MS = 4000;

export function NewClaimWizard({ open, onClose, members, contacts, role, selfId, onCreated }: NewClaimWizardProps) {
  const provider = useActiveProvider();
  const dispatch = useAppDispatch();
  // Submitters (contributors) claim only for themselves.
  const submitterOnly = !isApprover(role);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [receipts, setReceipts] = useState<ClaimableReceiptDto[]>([]);
  // False until the first load since the wizard opened has answered.
  const [receiptsLoaded, setReceiptsLoaded] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Uploaded here and still scanning: selected for the claim once they're read.
  const [autoSelect, setAutoSelect] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [typedNames, setTypedNames] = useState<string[]>([]);
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claimantKey, setClaimantKey] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  // A failed background refresh (polling) keeps the list it has.
  const applyReceipts = useCallback((result: Awaited<ReturnType<ReturnType<typeof fetchClaimReceipts>>>) => {
    setReceiptsLoaded(true);
    if (fetchClaimReceipts.fulfilled.match(result)) {
      setReceipts(result.payload);
      setReceiptsError(null);
    } else {
      setReceiptsError(errorMessage(result.payload, "Couldn't load your receipts."));
    }
  }, []);
  const loadReceipts = useCallback(async () => applyReceipts(await dispatch(fetchClaimReceipts())), [dispatch, applyReceipts]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    dispatch(fetchClaimReceipts()).then((result) => {
      if (!cancelled) applyReceipts(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, dispatch, applyReceipts]);

  // Poll while anything is still scanning.
  const scanning = receipts.some((r) => r.status === "processing");
  useEffect(() => {
    if (!open || !scanning) return;
    const timer = window.setInterval(() => void loadReceipts(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, scanning, loadReceipts]);

  // A receipt uploaded here gets selected the moment its scan is read — only
  // while the receipts step is showing, never behind the user's back on a
  // later step. Done during render (not in an effect) so the checkbox is
  // never a frame behind.
  const readyToSelect = step === 1 ? receipts.filter((r) => r.status === "pending" && autoSelect.has(r.id)) : [];
  if (readyToSelect.length > 0) {
    setSelected((prev) => new Set([...prev, ...readyToSelect.map((r) => r.id)]));
    setAutoSelect((prev) => {
      const next = new Set(prev);
      readyToSelect.forEach((r) => next.delete(r.id));
      return next;
    });
  }

  const options = useMemo(() => {
    const team = members.filter((m) => !submitterOnly || m.userId === selfId).map((m) => ({ id: m.userId, label: m.name }));
    if (submitterOnly) return team;
    const known = new Set(contacts.map((c) => c.name.toLowerCase()));
    return [
      ...team,
      ...contacts.map((c) => ({ id: `${CONTACT_PREFIX}${c.id}`, label: c.email ? `${c.name} (${c.email})` : c.name })),
      ...typedNames.filter((n) => !known.has(n.toLowerCase())).map((n) => ({ id: `${NAME_PREFIX}${n}`, label: n })),
    ];
  }, [members, contacts, typedNames, submitterOnly, selfId]);

  const effectiveClaimantKey = submitterOnly ? selfId : claimantKey;
  const claimantLabel = options.find((o) => o.id === effectiveClaimantKey)?.label ?? "";

  // It goes to the claimant's manager — a team member's own, or yours for
  // someone outside the team (a contact or a typed name). Shown from step 2.
  const claimantIsTeamMember = !!effectiveClaimantKey && !effectiveClaimantKey.startsWith(NAME_PREFIX) && !effectiveClaimantKey.startsWith(CONTACT_PREFIX);
  const approverFor = claimantIsTeamMember && effectiveClaimantKey !== selfId ? effectiveClaimantKey : null;
  const route = useApproverPreview(approverFor, open && step >= 2 && !!effectiveClaimantKey);
  const approverName = route.preview?.approver?.name ?? "";
  const autoApprove = !!route.preview?.autoApprove;

  const reset = () => {
    setStep(1);
    setSelected(new Set());
    setAutoSelect(new Set());
    setClaimantKey("");
    setNotes({});
  };

  const close = () => {
    if (creating || uploading) return;
    reset();
    setReceiptsLoaded(false);
    onClose();
  };

  // Only scanned receipts can go on the claim.
  const chosen = useMemo(() => receipts.filter((r) => r.status === "pending" && selected.has(r.id)), [receipts, selected]);
  const currencies = useMemo(() => [...new Set(chosen.map((r) => r.currency).filter(Boolean))], [chosen]);
  const total = chosen.reduce((sum, r) => sum + r.amount, 0);
  // The server files the claim under the month of its latest receipt.
  const month = useMemo(() => {
    const latest = chosen.map((r) => r.date).filter(Boolean).sort().pop();
    return (latest || todayIso()).slice(0, 7);
  }, [chosen]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;
    if (files.length > MAX_UPLOAD_FILES) {
      showToast(`You can upload up to ${MAX_UPLOAD_FILES} receipts at a time.`, "warning");
      return;
    }
    setUploading(true);
    const result = await dispatch(uploadClaimReceipts(files));
    setUploading(false);
    if (!uploadClaimReceipts.fulfilled.match(result)) {
      showToast(errorMessage(result.payload, "Couldn't upload the receipts."), "error");
      return;
    }
    const { ids, failed } = result.payload;
    setAutoSelect((prev) => new Set([...prev, ...ids]));
    if (failed.length > 0) showToast(`Couldn't upload ${failed.join(", ")}. Try again.`, "warning");
    if (ids.length > 0) showToast(`${ids.length} receipt${ids.length === 1 ? "" : "s"} uploaded — scanning now.`, "success");
    await loadReceipts();
  };

  const handleDelete = async (receipt: ClaimableReceiptDto) => {
    const ok = await confirmDialog({
      title: "Delete receipt?",
      message: `${receipt.status === "failed" ? "This receipt" : receipt.vendor} will be deleted. Nothing was sent to your accounting software.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    setDeletingId(receipt.id);
    const result = await dispatch(deleteClaimReceipt(receipt.id));
    setDeletingId(null);
    if (deleteClaimReceipt.fulfilled.match(result)) {
      setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(receipt.id);
        return next;
      });
    } else {
      showToast(errorMessage(result.payload, "Couldn't delete the receipt."), "error");
    }
  };

  const handleAddName = (name: string) => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      showToast("Type the claimant's name first, then add it.", "warning");
      return;
    }
    // Already a contact: pick that one instead of adding a duplicate.
    const existing = contacts.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setClaimantKey(`${CONTACT_PREFIX}${existing.id}`);
      return;
    }
    setTypedNames((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setClaimantKey(`${NAME_PREFIX}${trimmed}`);
  };

  const goNext = () => {
    // An approver claiming receipts one team member uploaded: that's most
    // likely the claimant, so start there.
    if (step === 1 && !submitterOnly && !claimantKey) {
      const uploaders = [...new Set(chosen.map((r) => r.uploadedBy?.id).filter(Boolean))];
      if (uploaders.length === 1 && members.some((m) => m.userId === uploaders[0])) setClaimantKey(uploaders[0] as string);
    }
    setStep((s) => (s + 1) as Step);
  };

  const handleCreate = async () => {
    if (!effectiveClaimantKey || !route.ready) return;
    setCreating(true);
    const claimant = effectiveClaimantKey.startsWith(NAME_PREFIX)
      ? { name: effectiveClaimantKey.slice(NAME_PREFIX.length) }
      : effectiveClaimantKey.startsWith(CONTACT_PREFIX)
        ? { contactId: effectiveClaimantKey.slice(CONTACT_PREFIX.length) }
        : { userId: effectiveClaimantKey };
    const filledNotes = Object.fromEntries(chosen.map((r) => [r.id, (notes[r.id] ?? "").trim()] as const).filter(([, note]) => note));
    const result = await dispatch(
      createExpenseClaim({ claimant, receiptIds: chosen.map((r) => r.id), notes: filledNotes }),
    );
    setCreating(false);
    if (createExpenseClaim.fulfilled.match(result)) {
      const { autoApproveError } = result.meta;
      if (autoApproveError) showToast(`Claim saved, but it couldn't be posted to ${provider.name} yet: ${autoApproveError} Fix it and approve it from Assigned to me.`, "warning");
      else if (result.payload.status === "awaiting_review") showToast(`Claim sent to ${result.payload.approver?.name ?? approverName} for approval.`, "success");
      else showToast(`Claim approved and posted to ${provider.name}.`, "success");
      reset();
      setReceiptsLoaded(false);
      onClose();
      onCreated();
    } else {
      showToast(errorMessage(result.payload, "Couldn't create the claim."), "error");
      void loadReceipts();
    }
  };

  const mixedCurrency = currencies.length > 1;
  const nextDisabled =
    (step === 1 && (chosen.length === 0 || mixedCurrency || uploading)) || (step === 2 && (!effectiveClaimantKey || !route.ready));

  const footer = (
    <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" onClick={step === 1 ? close : () => setStep((s) => (s - 1) as Step)} disabled={creating || uploading}>
        {step === 1 ? "Cancel" : "Back"}
      </Button>
      {step < 3 ? (
        <Button size="sm" onClick={goNext} disabled={nextDisabled}>
          Next
        </Button>
      ) : (
        <Button size="sm" onClick={handleCreate} loading={creating} disabled={creating || chosen.length === 0 || mixedCurrency || !route.ready}>
          {autoApprove ? `Approve & post to ${provider.name}` : `Send to ${approverName}`}
        </Button>
      )}
    </div>
  );

  const uploadButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} loading={uploading} disabled={uploading}>
        <Upload size={16} strokeWidth={2.25} />
        Upload receipts
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={close} title="New expense claim" widthClassName="max-w-lg" footer={footer}>
      <div className="flex flex-col gap-[var(--space-md)]">
        <div>
          <div className="flex items-center justify-between text-caption font-semibold text-content-secondary">
            <span>
              Step {step} of 3 · {STEP_TITLES[step]}
            </span>
          </div>
          <div className="mt-[var(--space-xs)]">
            <ProgressBar percent={(step / 3) * 100} label="Wizard progress" />
          </div>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <div className="flex items-center justify-between gap-[var(--space-sm)]">
              <p className="text-body-sm text-content-secondary">
                {submitterOnly ? "Upload the receipts you paid for out of pocket." : "Upload or pick the receipts the employee paid for out of pocket."}
              </p>
              <span className="shrink-0">{uploadButton}</span>
            </div>

            {!receiptsLoaded && receipts.length === 0 ? (
              <div className="flex justify-center p-[var(--space-lg)]">
                <Spinner />
              </div>
            ) : receiptsError && receipts.length === 0 ? (
              <p className="text-body-sm text-status-danger-text">{receiptsError}</p>
            ) : receipts.length === 0 ? (
              <EmptyState
                icon={<Inbox size={28} strokeWidth={1.75} />}
                title="No receipts yet"
                description="Upload a photo or PDF of each receipt. They're scanned like invoices, but they only ever go to your accounting software through an approved claim."
              />
            ) : (
              receipts.map((r) =>
                r.status === "pending" ? (
                  <label
                    key={r.id}
                    className={`flex cursor-pointer items-start gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] ${
                      selected.has(r.id) ? "border-accent bg-surface-alt" : "border-border bg-page"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="mt-1 rounded border-border-strong text-accent focus:ring-accent"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-[var(--space-sm)]">
                        <span className="truncate text-body-sm font-semibold text-content-primary">{r.vendor}</span>
                        <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(r.amount, r.currency)}</span>
                      </span>
                      <span className="text-caption text-content-secondary">
                        {shortDate(r.date)} · Tax {money(r.tax, r.currency)}
                        {!submitterOnly && r.uploadedBy && r.uploadedBy.id !== selfId ? ` · uploaded by ${r.uploadedBy.name}` : ""}
                      </span>
                    </span>
                    <DeleteReceiptButton receipt={r} busy={deletingId === r.id} onDelete={handleDelete} />
                  </label>
                ) : (
                  <div
                    key={r.id}
                    className="flex items-start gap-[var(--space-sm)] rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]"
                  >
                    <span className="mt-[2px] shrink-0">
                      {r.status === "processing" ? <Spinner size="sm" /> : <AlertCircle size={16} strokeWidth={2.25} className="text-status-danger-text" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">
                        {r.status === "processing" ? "Scanning receipt…" : "Couldn't read this receipt"}
                      </span>
                      <span className="block text-caption text-content-secondary">
                        {r.status === "processing" ? "It'll be ready to add in a moment." : r.reason || "Delete it and upload a clearer photo."}
                      </span>
                    </span>
                    {r.status === "failed" && <DeleteReceiptButton receipt={r} busy={deletingId === r.id} onDelete={handleDelete} />}
                  </div>
                ),
              )
            )}

            {mixedCurrency ? (
              <p className="text-caption font-semibold text-status-danger-text">
                These receipts are in different currencies ({currencies.join(", ")}). A claim is one bill, so put each currency on its own claim.
              </p>
            ) : (
              chosen.length > 0 && (
                <p className="text-caption font-semibold text-content-secondary">
                  {chosen.length} selected · {money(total, currencies[0])}
                </p>
              )
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <label className={FIELD_LABEL_CLASS}>Claimant *</label>
            {submitterOnly ? (
              <p className="rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-content-primary">
                {claimantLabel || "You"}
              </p>
            ) : (
              <CreatableCombobox
                options={options}
                noun="claimant"
                ariaLabel="Claimant"
                value={claimantKey}
                onSelect={setClaimantKey}
                onAddNew={handleAddName}
                placeholder="Search team members and contacts, or type a new name"
                uiSize="md"
              />
            )}
            <p className="text-caption text-content-secondary">
              {submitterOnly
                ? "You can only claim for yourself."
                : "When approved, the claim is posted as one bill payable to this person. Not on your team? Type their name — they're saved as a contact for next time."}
            </p>

            {effectiveClaimantKey && (
              <div className="mt-[var(--space-sm)]">
                <ApproverNotice loading={route.loading} preview={route.preview} error={route.error} providerName={provider.name} noun="claim" />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Claimant">{claimantLabel}</ModalDefinitionRow>
              <ModalDefinitionRow label="Approver">{autoApprove ? "You (owner) — approved on send" : approverName}</ModalDefinitionRow>
              <ModalDefinitionRow label="Month">{monthLabel(month)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Receipts">{chosen.length}</ModalDefinitionRow>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-md border border-border">
              {chosen.map((r) => (
                <div key={r.id} className="flex flex-col gap-[var(--space-xs)] px-[var(--space-md)] py-[var(--space-sm)]">
                  <div className="flex items-center justify-between gap-[var(--space-sm)]">
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">{r.vendor}</span>
                      <span className="block text-caption text-content-secondary">{shortDate(r.date)}</span>
                    </span>
                    <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(r.amount, r.currency)}</span>
                  </div>
                  <input
                    type="text"
                    aria-label={`Note for ${r.vendor}`}
                    placeholder="Add a note (optional), e.g. client lunch"
                    maxLength={500}
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    className="h-9 w-full rounded-md border border-border bg-page px-[var(--space-sm)] text-body-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)] text-body font-bold text-content-primary">
              <span>Total</span>
              <span>{money(total, currencies[0])}</span>
            </div>
            <p className="text-caption text-content-secondary">
              {autoApprove
                ? `It's approved and posted to ${provider.name} as one bill payable to the claimant as soon as you send it.`
                : `${approverName} gets it in Awaiting review. Approving it posts it to ${provider.name}; rejecting it keeps it out.`}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeleteReceiptButton({
  receipt,
  busy,
  onDelete,
}: {
  receipt: ClaimableReceiptDto;
  busy: boolean;
  onDelete: (receipt: ClaimableReceiptDto) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Delete ${receipt.status === "failed" ? "receipt" : receipt.vendor}`}
      onClick={(e) => {
        // Inside the row's <label>: don't toggle the checkbox too.
        e.preventDefault();
        onDelete(receipt);
      }}
      disabled={busy}
      className="shrink-0 rounded-md p-[var(--space-xs)] text-content-muted hover:bg-error/10 hover:text-error disabled:opacity-50"
    >
      <Trash2 size={16} strokeWidth={2.25} />
    </button>
  );
}
