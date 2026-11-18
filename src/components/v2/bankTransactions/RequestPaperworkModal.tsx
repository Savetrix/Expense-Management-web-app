"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal, SelectDropdown } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { useAppSelector } from "@/store/hooks";

import { formatAmount } from "./format";
import { fetchPaperworkTeam, requestPaperwork, type TeamMemberDto } from "./paperworkClient";
import type { BankTransaction } from "./types";

/**
 * "Request paperwork": asks a team member of this company for the receipts of
 * bank lines that have none (Saurabh, 18 Nov, after Briefcase). They see the
 * request on Bank Transactions → Paperwork requests, and get an email with a
 * link when this server can send email.
 */
export function RequestPaperworkModal({ lines, onClose, onSent }: { lines: BankTransaction[]; onClose: () => void; onSent: () => void }) {
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const me = useAppSelector((s) => s.auth.user?.data?.user);
  const [team, setTeam] = useState<TeamMemberDto[] | null>(null);
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!qbConnectionId) return;
    let cancelled = false;
    fetchPaperworkTeam(qbConnectionId).then(
      (members) => !cancelled && setTeam(members),
      (e: Error) => !cancelled && (setTeam([]), setError(e.message)),
    );
    return () => {
      cancelled = true;
    };
  }, [qbConnectionId]);

  const send = async () => {
    if (!qbConnectionId || !assignee) return;
    setBusy(true);
    setError("");
    try {
      const requesterName = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || me?.email || "A teammate";
      const created = await requestPaperwork(qbConnectionId, { lineIds: lines.map((l) => l.id), assigneeUserId: assignee, note, requesterName });
      showToast(
        created.emailed ? `Asked ${created.assignee.name} for ${lines.length} receipt${lines.length === 1 ? "" : "s"}. They got an email.` : `Asked ${created.assignee.name} for ${lines.length} receipt${lines.length === 1 ? "" : "s"}. They'll see it under Paperwork requests.`,
        "success",
      );
      onSent();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Request paperwork"
      footer={
        <div className="flex justify-end gap-[var(--space-sm)]">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={busy || !assignee}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <p className="text-body-sm text-content-secondary">
          Ask someone on the team for the receipt{lines.length === 1 ? "" : "s"} of {lines.length === 1 ? "this line" : `these ${lines.length} lines`}. They upload each one, and it is
          attached to the line.
        </p>
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border text-caption">
          {lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-[var(--space-sm)] border-b border-border px-[var(--space-sm)] py-[var(--space-xs)] last:border-b-0">
              <span className="truncate">
                {l.date} · {l.description}
              </span>
              <span className="shrink-0 font-semibold">{formatAmount(l.amount)}</span>
            </li>
          ))}
        </ul>
        <SelectDropdown label="Who has the receipts?" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!team || busy}>
          <option value="">{team === null ? "Loading the team…" : team.length === 0 ? "Nobody else on the team can open Bank Transactions" : "Pick a team member"}</option>
          {(team ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
              {m.email && m.email !== m.name ? ` (${m.email})` : ""}
            </option>
          ))}
        </SelectDropdown>
        <label className="flex flex-col gap-[var(--space-xs)] text-body-sm font-semibold text-content-primary">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            disabled={busy}
            placeholder="e.g. The fuel receipts from the Toronto trip"
            className="rounded-md border border-border bg-page px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-normal text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        {error && <p className="text-body-sm text-status-error-text">{error}</p>}
      </div>
    </Modal>
  );
}
