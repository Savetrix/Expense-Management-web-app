"use client";

import { FileText, Paperclip, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { showToast } from "@/lib/dialogManager";
import { formatPlainDate } from "@/lib/plainDate";
import { useAppSelector } from "@/store/hooks";

import { formatAmount } from "./format";
import { fetchPaperwork, openAttachment, uploadReceipt, type PaperworkRequestDto } from "./paperworkClient";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
const day = (iso: string) => formatPlainDate(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });

/**
 * Bank Transactions → Paperwork requests: every request (who asked, who it's
 * for, which lines, open or done, when it was sent). The person a request is
 * for uploads the receipt against each line here; a request is done once
 * every line has one.
 */
export function PaperworkTab({ onChanged }: { onChanged?: (openCount: number) => void }) {
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const [data, setData] = useState<{ me: string; requests: PaperworkRequestDto[] } | null>(null);
  const [error, setError] = useState("");
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [show, setShow] = useState<"open" | "all">("open");
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<{ requestId: string; lineId: string } | null>(null);

  const load = useCallback(async () => {
    if (!qbConnectionId) return;
    try {
      const next = await fetchPaperwork(qbConnectionId);
      setData(next);
      setError("");
      onChanged?.(next.requests.filter((r) => r.status === "open").length);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [qbConnectionId, onChanged]);

  useEffect(() => {
    // Loaded once on open; load() also runs after each upload.
    let cancelled = false;
    if (qbConnectionId) {
      fetchPaperwork(qbConnectionId).then(
        (next) => {
          if (cancelled) return;
          setData(next);
          onChanged?.(next.requests.filter((r) => r.status === "open").length);
        },
        (e: Error) => !cancelled && setError(e.message),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [qbConnectionId, onChanged]);

  const pick = (requestId: string, lineId: string) => {
    target.current = { requestId, lineId };
    fileInput.current?.click();
  };
  const upload = async (file: File | undefined) => {
    const t = target.current;
    if (!file || !t || !qbConnectionId) return;
    setBusyLine(t.lineId);
    try {
      const out = await uploadReceipt(qbConnectionId, t.requestId, t.lineId, file);
      showToast(out.status === "done" ? "Receipt attached. That was the last one: the request is done." : "Receipt attached to the line.", "success");
      await load();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setBusyLine(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const open = (lineId: string, fileId: string) => {
    if (qbConnectionId) openAttachment(qbConnectionId, lineId, fileId).catch((e: Error) => showToast(e.message, "error"));
  };

  if (error) return <p className="text-body-sm text-status-error-text">{error}</p>;
  if (!data) return <Spinner />;
  const requests = data.requests.filter((r) => show === "all" || r.status === "open");

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      <div className="flex items-center justify-between gap-[var(--space-sm)]">
        <p className="text-body-sm text-content-secondary">Receipts asked for bank lines that have no bill or receipt yet. Pick lines on Transactions, then &ldquo;Request paperwork&rdquo;.</p>
        <label className="flex shrink-0 items-center gap-[var(--space-xs)] text-caption font-semibold text-content-primary">
          <input type="checkbox" checked={show === "all"} onChange={(e) => setShow(e.target.checked ? "all" : "open")} />
          Show done
        </label>
      </div>
      {requests.length === 0 ? (
        <EmptyState icon={<FileText size={24} />} title={show === "open" ? "No open requests" : "No requests yet"} description="When someone asks for receipts, the request shows here." />
      ) : (
        requests.map((r) => {
          const mine = r.assignee.userId === data.me;
          const waiting = r.lines.filter((l) => !l.done).length;
          return (
            <section key={r.id} className="rounded-md border border-border bg-surface p-[var(--space-md)]">
              <div className="flex flex-wrap items-start justify-between gap-[var(--space-sm)]">
                <div className="min-w-0">
                  <p className="text-body-sm font-bold text-content-primary">
                    {r.requestedBy.name} asked {mine ? "you" : r.assignee.name} for {r.lines.length} receipt{r.lines.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-caption text-content-secondary">
                    Sent {day(r.createdAt)}
                    {r.emailed === true ? " · emailed" : r.emailed === false ? " · the email didn't go out" : ""}
                    {r.status === "done" && r.doneAt ? ` · done ${day(r.doneAt)}` : r.status === "open" ? ` · ${waiting} still to upload` : ""}
                  </p>
                  {r.note && <p className="mt-[var(--space-xs)] text-caption text-content-primary">&ldquo;{r.note}&rdquo;</p>}
                </div>
                <Badge variant={r.status === "done" ? "success" : "warning"}>{r.status === "done" ? "Done" : "Open"}</Badge>
              </div>
              <ul className="mt-[var(--space-sm)] divide-y divide-border rounded-md border border-border">
                {r.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] px-[var(--space-sm)] py-[var(--space-xs)] text-caption">
                    <span className="min-w-0 truncate">
                      {l.date} · {l.description} · <span className="font-semibold">{formatAmount(l.amount)}</span>
                      {l.currency ? ` ${l.currency}` : ""}
                    </span>
                    <span className="flex shrink-0 items-center gap-[var(--space-xs)]">
                      {l.attachments.map((a) => (
                        <button key={a.id} type="button" onClick={() => open(l.id, a.id)} className="inline-flex items-center gap-1 text-accent hover:underline" title={`Open ${a.name}`}>
                          <Paperclip size={13} strokeWidth={2.25} />
                          <span className="max-w-[10rem] truncate">{a.name}</span>
                        </button>
                      ))}
                      {!l.done && mine && r.status === "open" && (
                        <button
                          type="button"
                          disabled={busyLine !== null}
                          onClick={() => pick(r.id, l.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-[var(--space-sm)] font-semibold text-content-primary hover:bg-surface-alt disabled:opacity-50"
                        >
                          {busyLine === l.id ? <Spinner /> : <Upload size={13} strokeWidth={2.25} />}
                          Upload receipt
                        </button>
                      )}
                      {!l.done && !mine && <span className="text-content-muted">Waiting</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
