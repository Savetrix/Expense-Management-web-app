"use client";

import { AlertCircle, Inbox, Pencil, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { Modal, ModalDefinitionRow, ProgressBar } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  createExpenseClaim,
  deleteClaimReceipt,
  fetchClaimReceipts,
  uploadClaimReceipts,
  type ClaimableReceiptDto,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";

import { errorMessage, isApprover, money, monthLabel, receiptEditHref, shortDate, todayIso, type CompanyRole } from "./shared";
import { ApproverNotice, useApproverPreview } from "./ApproverNotice";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

interface NewClaimWizardProps {
  open: boolean;
  onClose: () => void;
  role: CompanyRole;
  selfId: string;
  /** False for a contributor without the Invoices page: receipts can't be opened for editing there. */
  canOpenInvoices: boolean;
  /** Receipts to tick when the wizard opens (coming back from editing one). */
  initialSelected?: string[] | null;
  onCreated: () => void;
}

type Step = 1 | 2;
const STEP_TITLES: Record<Step, string> = { 1: "Add receipts", 2: "Review & send" };

// Uploader key for a receipt whose uploader's account no longer exists.
const GONE = "__gone__";

// Same limit as the dashboard's scanner (the backend takes 10 files per upload).
const MAX_UPLOAD_FILES = 10;
// A scan usually takes well under a minute; check back this often meanwhile.
const POLL_MS = 4000;

// The claimant is whoever uploaded the receipts — nobody picks one (the
// backend works it out the same way and refuses receipts from two people).
export function NewClaimWizard({ open, onClose, role, selfId, canOpenInvoices, initialSelected, onCreated }: NewClaimWizardProps) {
  const provider = useActiveProvider();
  const dispatch = useAppDispatch();
  // Submitters (contributors) see and claim only their own uploads.
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

  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  // Coming back from a receipt's review screen: tick what was ticked before.
  const [seededFrom, setSeededFrom] = useState<string[] | null | undefined>(null);
  if (open && initialSelected && seededFrom !== initialSelected) {
    setSeededFrom(initialSelected);
    setSelected(new Set(initialSelected));
  }

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

  // Only scanned receipts can go on the claim.
  const chosen = useMemo(() => receipts.filter((r) => r.status === "pending" && selected.has(r.id)), [receipts, selected]);
  const currencies = useMemo(() => [...new Set(chosen.map((r) => r.currency).filter(Boolean))], [chosen]);
  // A receipt whose uploader's account is gone comes back with no uploader —
  // it counts as someone else's, so it never passes as yours.
  const uploaders = useMemo(() => [...new Set(chosen.map((r) => r.uploadedBy?.id ?? GONE))], [chosen]);
  const mixedCurrency = currencies.length > 1;
  const mixedUploaders = uploaders.length > 1;
  const total = chosen.reduce((sum, r) => sum + r.amount, 0);
  // The server files the claim under the month of its latest receipt.
  const month = useMemo(() => {
    const latest = chosen.map((r) => r.date).filter(Boolean).sort().pop();
    return (latest || todayIso()).slice(0, 7);
  }, [chosen]);

  // Whose claim it is: the one person who uploaded the chosen receipts.
  const uploaderGone = uploaders.includes(GONE);
  const claimantId = mixedUploaders || uploaderGone ? "" : (uploaders[0] ?? "");
  const claimantName = claimantId === selfId ? "You" : (chosen.find((r) => r.uploadedBy?.id === claimantId)?.uploadedBy?.name ?? "");

  // Who it goes to (the claimant's manager), checked as soon as receipts are
  // picked — a claimant with no manager can't be sent, and the wizard says so
  // before Next instead of failing at the end.
  const route = useApproverPreview(claimantId && claimantId !== selfId ? claimantId : null, open && !!claimantId);
  const approverName = route.preview?.approver?.userId === selfId ? "you" : (route.preview?.approver?.name ?? "");
  const autoApprove = !!route.preview?.autoApprove;

  // Approving posts the bill, which needs a GL account on every receipt.
  const uncoded = chosen.filter((r) => !r.glAccountId);
  // The owner's own are approved as they're sent — so they must be coded first.
  const blockedByGl = autoApprove && uncoded.length > 0;

  // Coming back here after editing a receipt keeps these ticked.
  const editHref = (receiptId: string) => receiptEditHref(receiptId, `/reimbursements?newClaim=${[...selected].join(",")}`);

  const reset = () => {
    setStep(1);
    setSelected(new Set());
    setAutoSelect(new Set());
    setNotes({});
  };

  const close = () => {
    if (creating || uploading) return;
    reset();
    setReceiptsLoaded(false);
    onClose();
  };

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

  const handleCreate = async () => {
    if (!claimantId || !route.ready || blockedByGl) return;
    setCreating(true);
    const filledNotes = Object.fromEntries(chosen.map((r) => [r.id, (notes[r.id] ?? "").trim()] as const).filter(([, note]) => note));
    const result = await dispatch(createExpenseClaim({ receiptIds: chosen.map((r) => r.id), notes: filledNotes }));
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

  const nextDisabled = chosen.length === 0 || mixedCurrency || mixedUploaders || uploaderGone || uploading || !route.ready;

  const footer = (
    <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
      <Button variant="outline" size="sm" onClick={step === 1 ? close : () => setStep(1)} disabled={creating || uploading}>
        {step === 1 ? "Cancel" : "Back"}
      </Button>
      {step === 1 ? (
        <Button size="sm" onClick={() => setStep(2)} disabled={nextDisabled}>
          Next
        </Button>
      ) : (
        <Button size="sm" onClick={handleCreate} loading={creating} disabled={creating || nextDisabled || blockedByGl}>
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

  const editLink = (receipt: ClaimableReceiptDto, label = "Edit details") =>
    canOpenInvoices && (
      <Link
        href={editHref(receipt.id)}
        // Inside the row's <label>: don't toggle the checkbox too.
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-[var(--space-xs)] text-caption font-bold text-accent hover:underline"
      >
        <Pencil size={12} strokeWidth={2.5} />
        {label}
      </Link>
    );

  const receiptRow = (r: ClaimableReceiptDto) =>
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
          <span className="block text-caption text-content-secondary">
            {shortDate(r.date)} · Tax {money(r.tax, r.currency)} ·{" "}
            {r.glAccount ?? (r.glAccountId ? "GL account set" : <span className="text-status-warning-text">No GL account</span>)}
          </span>
          <span className="mt-[2px] block">{editLink(r)}</span>
        </span>
        <DeleteReceiptButton receipt={r} busy={deletingId === r.id} onDelete={handleDelete} />
      </label>
    ) : (
      <div key={r.id} className="flex items-start gap-[var(--space-sm)] rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
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
    );

  // An approver sees everyone's receipts — grouped by who uploaded them, since
  // a claim takes one person's.
  const groups = useMemo(() => {
    const byUploader = new Map<string, { name: string; items: ClaimableReceiptDto[] }>();
    for (const r of receipts) {
      const id = r.uploadedBy?.id ?? GONE;
      const name = id === selfId ? "Your receipts" : (r.uploadedBy?.name ?? "Uploader no longer on the team");
      const group = byUploader.get(id) ?? { name, items: [] };
      group.items.push(r);
      byUploader.set(id, group);
    }
    // Your own first.
    return [...byUploader.entries()].sort(([a], [b]) => (a === selfId ? -1 : b === selfId ? 1 : 0)).map(([, g]) => g);
  }, [receipts, selfId]);

  return (
    <Modal open={open} onClose={close} title="New reimbursement" widthClassName="max-w-lg" footer={footer}>
      <div className="flex flex-col gap-[var(--space-md)]">
        <div>
          <div className="flex items-center justify-between text-caption font-semibold text-content-secondary">
            <span>
              Step {step} of 2 · {STEP_TITLES[step]}
            </span>
          </div>
          <div className="mt-[var(--space-xs)]">
            <ProgressBar percent={(step / 2) * 100} label="Wizard progress" />
          </div>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <div className="flex items-center justify-between gap-[var(--space-sm)]">
              <p className="text-body-sm text-content-secondary">
                {submitterOnly
                  ? "Upload the receipts you paid for out of pocket. Check what was read, and fix it with Edit details."
                  : "Pick one person's receipts — the claim is theirs and repays them."}
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
            ) : groups.length > 1 ? (
              groups.map((g) => (
                <div key={g.name} className="flex flex-col gap-[var(--space-sm)]">
                  <p className="text-tiny font-bold uppercase tracking-wider text-content-muted">{g.name}</p>
                  {g.items.map(receiptRow)}
                </div>
              ))
            ) : (
              receipts.map(receiptRow)
            )}

            {uploaderGone && !mixedUploaders ? (
              <p role="status" className="text-caption font-semibold text-status-danger-text">
                Whoever uploaded {chosen.length === 1 ? "this receipt" : "these receipts"} is no longer on the team, so it can&apos;t be claimed — delete it instead.
              </p>
            ) : mixedUploaders ? (
              <p role="status" className="text-caption font-semibold text-status-danger-text">
                These receipts were uploaded by different people. A claim repays one person, so pick one person&apos;s receipts.
              </p>
            ) : mixedCurrency ? (
              <p role="status" className="text-caption font-semibold text-status-danger-text">
                These receipts are in different currencies ({currencies.join(", ")}). A claim is one bill, so put each currency on its own claim.
              </p>
            ) : (
              chosen.length > 0 && (
                <>
                  <p className="text-caption font-semibold text-content-secondary">
                    {chosen.length} selected · {money(total, currencies[0])}
                    {claimantId !== selfId && claimantName ? ` · claim for ${claimantName}` : ""}
                  </p>
                  <ApproverNotice loading={route.loading} preview={route.preview} error={route.error} providerName={provider.name} noun="claim" selfId={selfId} />
                </>
              )
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <ModalDefinitionRow label="Claimant">{claimantName}</ModalDefinitionRow>
              <ModalDefinitionRow label="Approver">{autoApprove ? "You (owner) — approved on send" : approverName === "you" ? "You" : approverName}</ModalDefinitionRow>
              <ModalDefinitionRow label="Month">{monthLabel(month)}</ModalDefinitionRow>
              <ModalDefinitionRow label="Receipts">{chosen.length}</ModalDefinitionRow>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-md border border-border">
              {chosen.map((r) => (
                <div key={r.id} className="flex flex-col gap-[var(--space-xs)] px-[var(--space-md)] py-[var(--space-sm)]">
                  <div className="flex items-center justify-between gap-[var(--space-sm)]">
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">{r.vendor}</span>
                      <span className="block text-caption text-content-secondary">
                        {shortDate(r.date)} · {r.glAccount ?? (r.glAccountId ? "GL account set" : "No GL account")}
                      </span>
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
            {uncoded.length > 0 && (
              <div
                role="status"
                className={`rounded-md border px-[var(--space-md)] py-[var(--space-sm)] text-body-sm ${
                  blockedByGl
                    ? "border-status-warning-border bg-status-warning-bg text-status-warning-text"
                    : "border-border bg-page text-content-secondary"
                }`}
              >
                <p>
                  {blockedByGl
                    ? `It's posted to ${provider.name} the moment you send it, so every receipt needs a GL account first:`
                    : `No GL account yet on ${uncoded.length === 1 ? "this receipt" : "these receipts"} — ${approverName} picks one before approving:`}
                </p>
                <ul className="mt-[var(--space-xs)] flex flex-col gap-[2px]">
                  {uncoded.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-[var(--space-sm)]">
                      <span className="truncate font-semibold">{r.vendor}</span>
                      {editLink(r, "Pick GL account")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-caption text-content-secondary">
              {autoApprove
                ? `It's approved and posted to ${provider.name} as one bill payable to the claimant as soon as you send it.`
                : `${approverName === "you" ? "You get" : `${approverName} gets`} it in Awaiting review. Approving it posts it to ${provider.name}; rejecting it keeps it out.`}
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
