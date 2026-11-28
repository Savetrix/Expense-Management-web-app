"use client";

import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { DataTable, Modal, ModalDefinitionRow } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useAppDispatch } from "@/store/hooks";
import {
  archivePrepayment,
  fetchPrepayment,
  publishPrepayment,
  retryPrepayment,
  unarchivePrepayment,
  updatePrepayment,
} from "@/store/monthEnd/monthEndApi";
import type { MonthEndRequestError, PrepaymentDto, PrepaymentEntryDto, PrepaymentPatch } from "@/store/monthEnd/monthEndApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { dateLabel, formatMoney, periodCoveredLabel } from "./format";
import { ERROR_NOTE_CLASS, NOTE_CLASS, SECTION_TITLE_CLASS, SelectField, StatusBadge, TextField, useMonthEndAccounts } from "./shared";

const POLL_MS = 2000;

interface Props {
  prepayment: PrepaymentDto;
  /** Read-only for anyone who can't post (an accountant can, a viewer can't). */
  canPost: boolean;
  onClose: () => void;
  onChange: (prepayment: PrepaymentDto) => void;
}

interface Draft {
  startDate: string;
  endDate: string;
  releaseFrom: string;
  pnlAccountId: string;
  /** Releases typed in here and not saved yet, by entry number (the input's text). */
  amounts: Record<number, string>;
}

const draftOf = (p: PrepaymentDto): Draft => ({
  startDate: p.startDate,
  endDate: p.endDate,
  releaseFrom: p.releaseFrom ?? "",
  pnlAccountId: p.pnlAccountId ?? "",
  amounts: {},
});

const cents = (n: number) => Math.round(n * 100);
// A typed release: a number of 0 or more with at most 2 decimals, else null.
const parseAmount = (text: string): number | null => {
  const t = text.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Number(t);
};

// What changed in the draft, as the PATCH body.
const patchOf = (p: PrepaymentDto, d: Draft): PrepaymentPatch => {
  const patch: PrepaymentPatch = {};
  if (d.startDate !== p.startDate) patch.startDate = d.startDate;
  if (d.endDate !== p.endDate) patch.endDate = d.endDate;
  if ((d.releaseFrom || null) !== p.releaseFrom) patch.releaseFrom = d.releaseFrom || null;
  if ((d.pnlAccountId || null) !== p.pnlAccountId) patch.pnlAccountId = d.pnlAccountId || null;
  // A new period or reference date regroups and renumbers the entries — typed
  // releases (keyed by the old numbers) never go out with it.
  if (patch.startDate || patch.endDate || patch.releaseFrom !== undefined) return patch;
  const amounts = Object.entries(d.amounts)
    .map(([seq, text]) => ({ seq: Number(seq), amount: parseAmount(text) }))
    .filter((a): a is { seq: number; amount: number } => a.amount != null && cents(a.amount) !== cents(p.entries.find((e) => e.seq === a.seq)?.amount ?? NaN));
  if (amounts.length > 0) patch.amounts = amounts;
  return patch;
};

function JournalCell({ entry, prepayment }: { entry: PrepaymentEntryDto; prepayment: PrepaymentDto }) {
  if (entry.trackedOnly) return <span className="text-content-secondary">No journal (0.00)</span>;
  if (entry.status === "posted") {
    return entry.url ? (
      <a href={entry.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
        <Badge variant="success">Posted</Badge>
        <ExternalLink size={12} strokeWidth={2.25} />
      </a>
    ) : (
      <Badge variant="success">Posted</Badge>
    );
  }
  if (entry.status === "failed") {
    return (
      <span title={entry.error ?? undefined} className="block truncate">
        {entry.outcomeUnknown ? <Badge variant="warning">Not confirmed</Badge> : <Badge variant="error">Failed</Badge>}{" "}
        <span className="text-caption text-error">{entry.error}</span>
      </span>
    );
  }
  if (entry.status === "removed") return <span className="text-content-secondary">Removed</span>;
  if (prepayment.posting && prepayment.postingJob !== "archive") return <span className="text-content-secondary">Posting…</span>;
  return <span className="text-content-secondary">{prepayment.status === "review" ? "Posts on publish" : "Not posted"}</span>;
}

export function PrepaymentScheduleModal({ prepayment: initial, canPost, onClose, onChange }: Props) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const [p, setP] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [busy, setBusy] = useState<"" | "save" | "publish" | "retry" | "archive" | "unarchive">("");
  const [error, setError] = useState("");
  const { pnlAccounts } = useMonthEndAccounts({ pnl: [p.pnlAccountId] });
  // Re-arms the poll after a failed read (a blip mustn't leave it "Posting…" forever).
  const [pollTick, setPollTick] = useState(0);

  const editable = canPost && p.status === "review";
  const dirty = Object.keys(patchOf(p, draft)).length > 0;
  // A new period means new months — the releases are recalculated on save,
  // so they can't be edited until it's saved.
  const periodDirty = draft.startDate !== p.startDate || draft.endDate !== p.endDate;
  // A new reference date regroups the entries too.
  const layoutDirty = periodDirty || (draft.releaseFrom || null) !== p.releaseFrom;
  const badAmount = Object.values(draft.amounts).some((t) => parseAmount(t) == null);
  // The table as typed: an edited release changes only its own month; every
  // balance after it follows from the prepaid total.
  const rows = useMemo(() => {
    let released = 0;
    return p.entries.map((e) => {
      const typed = draft.amounts[e.seq];
      const amount = typed !== undefined ? (parseAmount(typed) ?? e.amount) : e.amount;
      released += cents(amount);
      const changed = typed !== undefined && cents(amount) !== cents(e.amount);
      return { ...e, amount, balanceAfter: (cents(p.total) - released) / 100, typed: changed, trackedOnly: changed ? amount === 0 : e.trackedOnly };
    });
  }, [p, draft.amounts]);
  const leftOver = rows.length ? rows[rows.length - 1].balanceAfter : 0;
  const balanced = cents(leftOver) === 0;
  const editedCount = rows.filter((r) => r.typed || (r.edited && draft.amounts[r.seq] === undefined)).length;
  // Changing the period or reference date drops typed releases: the entries
  // they were typed against are regrouped and renumbered.
  const set = (key: Exclude<keyof Draft, "amounts">, value: string) =>
    setDraft((d) => ({ ...d, [key]: value, ...(key === "startDate" || key === "endDate" || key === "releaseFrom" ? { amounts: {} } : {}) }));

  const apply = useCallback(
    (next: PrepaymentDto) => {
      setP(next);
      setDraft(draftOf(next));
      onChange(next);
    },
    [onChange],
  );

  // While journals are being posted in the background, follow along.
  useEffect(() => {
    if (!p.posting) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await dispatch(fetchPrepayment(p._id));
      // Closed (or the company changed) while the read was in flight.
      if (cancelled) return;
      if (!fetchPrepayment.fulfilled.match(result)) {
        setPollTick((t) => t + 1);
        return;
      }
      {
        apply(result.payload);
        if (!result.payload.posting) {
          const s = result.payload;
          if (s.status === "archived") showToast(`Schedule archived — its journals were removed from ${provider.name}.`, "success");
          else if (s.lastErrorCode === "REMOVE_FAILED") showToast(s.lastError ?? "Some journals couldn't be removed.", "error");
          else if (s.status === "review") showToast(s.lastError ?? `Nothing could be posted to ${provider.name}.`, "error");
          else if (s.failedCount > 0) showToast(`${s.postedCount} journals posted, ${s.failedCount} failed — see the schedule.`, "warning");
          else showToast(`All journals posted to ${provider.name}.`, "success");
        }
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [p, pollTick, dispatch, apply, provider.name]);

  const run = async (kind: typeof busy, thunk: () => Promise<{ ok: true; value: PrepaymentDto } | { ok: false; error: MonthEndRequestError }>) => {
    setBusy(kind);
    setError("");
    const result = await thunk();
    setBusy("");
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    apply(result.value);
    return result.value;
  };

  const save = () => {
    // An empty date field would go out as "" (the API wants YYYY-MM-DD).
    if (!draft.startDate || !draft.endDate) {
      setError("Enter the service start and end dates.");
      return Promise.resolve(null);
    }
    if (badAmount) {
      setError("A release must be a number of 0 or more, with up to 2 decimals.");
      return Promise.resolve(null);
    }
    return run("save", async () => {
      const r = await dispatch(updatePrepayment({ id: p._id, patch: patchOf(p, draft) }));
      return updatePrepayment.fulfilled.match(r) ? { ok: true, value: r.payload } : { ok: false, error: r.payload ?? { message: "Couldn't save." } };
    });
  };

  const simple = (kind: "publish" | "retry" | "archive" | "unarchive") => {
    const thunk = { publish: publishPrepayment, retry: retryPrepayment, archive: archivePrepayment, unarchive: unarchivePrepayment }[kind];
    return run(kind, async () => {
      const r = await dispatch(thunk(p._id));
      return thunk.fulfilled.match(r) ? { ok: true, value: r.payload } : { ok: false, error: r.payload ?? { message: "Something went wrong." } };
    });
  };

  const publish = async () => {
    if (!p.balanceAccountId || !draft.pnlAccountId) return setError("Choose the expense account it's released to.");
    if (!balanced) return setError(`The releases must add up to ${formatMoney(p.total, p.currency)} — change a month so the last balance is 0.00.`);
    // The count must come from the schedule as just saved, not the one on screen before.
    const current = dirty ? await save() : p;
    if (!current) return;
    // What was saved is what publishes — check it, not the screen.
    if (!current.balanced) return setError(`The releases must add up to ${formatMoney(current.total, current.currency)} — change an entry so the last balance is 0.00.`);
    const toPost = current.entries.filter((e) => !e.trackedOnly).length;
    const ok = await confirmDialog({
      title: "Publish this schedule?",
      message: `${toPost} journal${toPost === 1 ? "" : "s"} will be posted to ${provider.name} now, including the future-dated ones. Each moves one month from the prepaid account to the expense account.`,
      confirmLabel: "Publish schedule",
    });
    if (ok) await simple("publish");
  };

  const archive = async () => {
    if (p.status === "active") {
      const ok = await confirmDialog({
        title: "Archive this prepayment?",
        message: `Its ${p.postedCount} posted journal${p.postedCount === 1 ? "" : "s"} will be removed from ${provider.name} (deleted, or voided where ${provider.name} doesn't allow deleting). The bill stays on the prepaid account.`,
        confirmLabel: "Archive and remove journals",
        tone: "destructive",
      });
      if (!ok) return;
    }
    const result = await simple("archive");
    // A published one finishes in the background — the poll reports how it went.
    if (result && !result.posting) showToast("Schedule archived.", "success");
  };

  const unarchive = async () => {
    if (await simple("unarchive")) showToast("Moved back to To review.", "success");
  };

  const columns: DataTableColumn<PrepaymentEntryDto>[] = [
    { key: "seq", header: "#", width: "44px", render: (e) => <span className="text-content-secondary">{e.seq}</span> },
    { key: "date", header: "Journal date", width: "120px", render: (e) => <span className="font-semibold">{dateLabel(e.date)}</span> },
    {
      key: "covers",
      header: "Covers",
      width: "200px",
      render: (e) =>
        e.catchUp ? (
          <span className="block text-content-secondary">
            <span className="block font-semibold text-content-primary">Catch-up ({e.months} months)</span>
            <span className="block text-caption">
              {dateLabel(e.periodStart)} – {dateLabel(e.periodEnd)}
            </span>
          </span>
        ) : (
          <span className="block truncate text-content-secondary">{periodCoveredLabel(e.periodStart, e.periodEnd, e.days)}</span>
        ),
    },
    {
      key: "amount",
      header: `Release${p.currency ? ` (${p.currency})` : ""}`,
      width: "130px",
      align: "right",
      render: (e) =>
        editable && !layoutDirty ? (
          <span className="flex items-center justify-end gap-1">
            {(e.edited || (e as PrepaymentEntryDto & { typed?: boolean }).typed) && <span title="Edited" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Release for entry ${e.seq}: ${e.catchUp ? `catch-up of ${e.months} months` : periodCoveredLabel(e.periodStart, e.periodEnd, e.days)}`}
              aria-invalid={draft.amounts[e.seq] !== undefined && parseAmount(draft.amounts[e.seq]) == null}
              disabled={working}
              value={draft.amounts[e.seq] ?? e.amount.toFixed(2)}
              onChange={(ev) => setDraft((d) => ({ ...d, amounts: { ...d.amounts, [e.seq]: ev.target.value } }))}
              className={`h-8 w-[96px] rounded-md border bg-page px-2 text-right text-body-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                draft.amounts[e.seq] !== undefined && parseAmount(draft.amounts[e.seq]) == null ? "border-error" : "border-border"
              }`}
            />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            {e.edited && <span title="Edited" className="h-1.5 w-1.5 rounded-full bg-accent" />}
            {formatMoney(e.amount)}
          </span>
        ),
    },
    // A foreign bill's journals post in the home currency (spread from the bill's own home value).
    ...(p.homeCurrency
      ? [{ key: "home", header: `Journal (${p.homeCurrency})`, width: "120px", align: "right" as const, render: (e: PrepaymentEntryDto) => (e.homeAmount != null ? formatMoney(e.homeAmount) : "—") }]
      : []),
    { key: "balance", header: "Balance after", width: "120px", align: "right", render: (e) => formatMoney(e.balanceAfter) },
    { key: "journal", header: "Journal", width: "190px", render: (e) => <JournalCell entry={e} prepayment={p} /> },
  ];

  const working = !!busy || p.posting;
  // Failed, or never reached (a run cut short by a restart or a reconnect stop).
  const notPosted = p.entries.filter((e) => !e.trackedOnly && e.status !== "posted" && e.status !== "removed").length;
  // An archive that got part-way: only archiving again may finish it.
  const archiveUnfinished = p.entries.some((e) => e.status === "removed");

  return (
    <Modal
      open
      onClose={onClose}
      title={p.status === "review" ? "Review prepayment schedule" : "Prepayment schedule"}
      widthClassName="max-w-4xl"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-[var(--space-sm)]">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {canPost && (p.status === "review" || p.status === "active") && (
            <Button variant="outline" size="sm" onClick={archive} disabled={working} loading={busy === "archive"}>
              Archive
            </Button>
          )}
          {canPost && p.status === "archived" && (
            <Button size="sm" onClick={unarchive} disabled={working} loading={busy === "unarchive"}>
              Restore to review
            </Button>
          )}
          {editable && dirty && (
            <Button variant="outline" size="sm" onClick={save} disabled={working} loading={busy === "save"}>
              Save changes
            </Button>
          )}
          {editable && (
            <Button size="sm" onClick={publish} disabled={working || p.entries.length === 0 || !balanced || badAmount} loading={busy === "publish"}>
              Publish schedule
            </Button>
          )}
          {canPost && p.status === "active" && !p.posting && notPosted > 0 && !archiveUnfinished && (
            <Button size="sm" onClick={() => simple("retry")} disabled={working} loading={busy === "retry"}>
              Retry {notPosted} not posted
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
          <div className="min-w-0">
            <p className="text-h3 font-bold text-content-primary">{p.vendorName ?? "Prepayment"}</p>
            <p className="text-body-sm text-content-secondary">
              {formatMoney(p.total, p.currency)} · {p.months} month{p.months === 1 ? "" : "s"}
            </p>
          </div>
          <StatusBadge status={p.displayStatus} />
        </div>

        <Link href={`/invoices/${p.invoiceId}`} className="inline-flex items-center gap-[var(--space-xs)] text-body-sm font-semibold text-accent hover:underline">
          <FileText size={16} strokeWidth={2} />
          Source invoice {p.sourceRef ?? ""}
        </Link>

        {p.posting && (
          <p className={`${NOTE_CLASS} flex items-center gap-[var(--space-sm)]`}>
            <Spinner size="sm" />
            {p.postingJob === "archive"
              ? `Removing journals from ${provider.name}… ${p.entries.filter((e) => e.status === "removed").length} of ${p.entries.filter((e) => e.status === "posted" || e.status === "removed").length} done.`
              : `Posting journals to ${provider.name}… ${p.postedCount} of ${p.entries.filter((e) => !e.trackedOnly).length} done.`}
          </p>
        )}
        {(error || (!p.posting && p.lastError)) && <p className={ERROR_NOTE_CLASS}>{error || p.lastError}</p>}

        {editable ? (
          <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-3">
            <TextField label="Service start" type="date" value={draft.startDate} onChange={(v) => set("startDate", v)} disabled={working} />
            <TextField label="Service end" type="date" value={draft.endDate} onChange={(v) => set("endDate", v)} disabled={working} />
            <div>
              <TextField
                label={draft.releaseFrom ? "Reference date" : "Reference date (today, automatic)"}
                type="date"
                value={draft.releaseFrom || p.referenceDate || ""}
                onChange={(v) => set("releaseFrom", v)}
                disabled={working}
                hint="Months before this date's month are added up into one catch-up entry on this date; the rest stay monthly. Set it to the service start to post every month on its own date."
              />
              {draft.releaseFrom && (
                <button type="button" onClick={() => set("releaseFrom", "")} disabled={working} className="mt-1 text-caption font-bold text-accent hover:underline">
                  Use today (automatic)
                </button>
              )}
            </div>
            {/* Fixed: the journals must credit the account the bill was posted to. */}
            <TextField
              label="Prepaid account (credited)"
              value={p.balanceAccountName ?? p.balanceAccountId ?? "—"}
              onChange={() => {}}
              disabled
              hint="Where the bill was posted. Edit the invoice to move it."
            />
            <SelectField label="Expense account (debited)" value={draft.pnlAccountId} onChange={(v) => set("pnlAccountId", v)} options={pnlAccounts} />
          </div>
        ) : (
          <div className="rounded-md border border-border px-[var(--space-md)]">
            <ModalDefinitionRow label="Service period">
              {dateLabel(p.startDate)} – {dateLabel(p.endDate)}
            </ModalDefinitionRow>
            {p.releaseFrom && <ModalDefinitionRow label="Reference date">{dateLabel(p.releaseFrom)}</ModalDefinitionRow>}
            <ModalDefinitionRow label="From (prepaid)">{p.balanceAccountName ?? p.balanceAccountId ?? "—"}</ModalDefinitionRow>
            <ModalDefinitionRow label="To (expense)">{p.pnlAccountName ?? p.pnlAccountId ?? "—"}</ModalDefinitionRow>
            <ModalDefinitionRow label="Released to date">{formatMoney(p.releasedToDate, p.currency)}</ModalDefinitionRow>
          </div>
        )}

        <div className="flex flex-col gap-[var(--space-sm)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
            <p className={SECTION_TITLE_CLASS}>Monthly release schedule{layoutDirty ? " (save to recalculate)" : ""}</p>
            {editable && editedCount > 0 && (
              <button
                type="button"
                disabled={working}
                onClick={async () => {
                  // Unsaved edits just go; saved ones go back to the calculation.
                  // Only the releases are reset — other unsaved changes stay, and
                  // the typed values stay too if the reset fails.
                  if (p.editedCount === 0) return setDraft((d) => ({ ...d, amounts: {} }));
                  setBusy("save");
                  setError("");
                  const r = await dispatch(updatePrepayment({ id: p._id, patch: { amounts: null } }));
                  setBusy("");
                  if (!updatePrepayment.fulfilled.match(r)) return setError(r.payload?.message ?? "Couldn't reset.");
                  setP(r.payload);
                  onChange(r.payload);
                  setDraft((d) => ({ ...d, amounts: {} }));
                }}
                className="text-caption font-bold text-accent hover:underline disabled:opacity-50"
              >
                Reset to calculated
              </button>
            )}
          </div>
          {editable && !layoutDirty && <p className="text-caption text-content-secondary">Change any release — only that entry changes; the balances after it follow.</p>}
          {editable && badAmount && <p className={ERROR_NOTE_CLASS}>A release must be a number of 0 or more, with up to 2 decimals — fix the highlighted entry.</p>}
          {editable && !balanced && (
            <p className={ERROR_NOTE_CLASS}>
              The releases add up to {formatMoney(rows.reduce((t, r) => t + r.amount, 0), p.currency)}, not {formatMoney(p.total, p.currency)} —{" "}
              {formatMoney(leftOver, p.currency)} would {leftOver > 0 ? "stay in" : "be taken beyond"} the prepaid account. Change a month so the last
              balance is 0.00 before publishing.
            </p>
          )}
          <DataTable columns={columns} rows={rows} getRowKey={(e) => String(e.seq)} maxHeightClassName="max-h-[320px]" />
        </div>

        <p className={NOTE_CLASS}>
          Publishing posts every journal to {provider.name} at once, future-dated ones included. Each one debits the expense account and credits the
          prepaid account, without tax — the tax was handled on the bill. Full months release the same amount; the first and last months are cut by
          the days they cover, and the last entry takes any rounding so the total matches exactly.
        </p>
      </div>
    </Modal>
  );
}
