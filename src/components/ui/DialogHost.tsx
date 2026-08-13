"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  CONFIRM_REQUEST,
  ConfirmRequest,
  dialogEmitter,
  getNotifications,
  NOTIFICATIONS_CHANGED,
  type NotificationItem,
} from "@/lib/dialogManager";
import { Button } from "@/components/ui/Button";

// Single global subscriber for src/lib/dialogManager.ts's emitter — mounted
// once in Providers so every route (including auth pages) can call
// confirmDialog() from a plain event handler with no context wiring at the
// call site. Replaces window.confirm; see DESIGN_ASSUMPTIONS.md D1.3.
// This host also renders showToast() output as a bottom-corner toast, and
// NotificationBell keeps the scrollback. That split was briefly the other way
// round — the bell alone — and manual QA showed why it does not work:
//
//   * The bell lives in AppShell, which AuthGate skips for the shell-less
//     routes, so every toast on /login, /register, /forgot-password,
//     /invite/accept and /paywall rendered nothing at all.
//   * On the routes that do have a shell, the bell's 4s bubble sits in the
//     top-right at z-[100] — the same z-index as the confirm dialog's
//     full-screen backdrop, and later in the DOM, so it painted over it.
//     Errors raised by confirming a destructive action (post to QuickBooks,
//     choose a plan) were reported as "silently swallowed" for exactly this
//     reason: showToast WAS called with the backend's message, and nobody
//     could see it.
//
// So the toast renders above dialogs, from a host mounted on every route, and
// error-tone messages stay up longer and must be dismissed deliberately.
const TOAST_MS = { error: 9000, success: 4500, info: 4500 } as const;

const TOAST_ICON = { success: CheckCircle2, error: XCircle, info: Info } as const;
const TOAST_ICON_CLASS = {
  success: "text-success",
  error: "text-error",
  info: "text-info",
} as const;

export function DialogHost() {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  // Ids already surfaced as a toast. Without this, mark-read/mark-all-read
  // rewrite the same entries and every past message would pop up again.
  const shownRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const onConfirm = (request: ConfirmRequest) => setConfirmRequest(request);
    dialogEmitter.on(CONFIRM_REQUEST, onConfirm);
    return () => {
      dialogEmitter.off(CONFIRM_REQUEST, onConfirm);
    };
  }, []);

  useEffect(() => {
    // Anything already in the log before this host mounted is history, not news.
    for (const seeded of getNotifications()) shownRef.current.add(seeded.id);

    const onChange = (next: NotificationItem[]) => {
      const fresh = next.filter((n) => !shownRef.current.has(n.id));
      if (fresh.length === 0) return;
      for (const n of fresh) shownRef.current.add(n.id);
      // Newest last so the stack reads top-to-bottom in arrival order.
      setToasts((current) => [...current, ...[...fresh].reverse()]);
    };
    dialogEmitter.on(NOTIFICATIONS_CHANGED, onChange);
    return () => {
      dialogEmitter.off(NOTIFICATIONS_CHANGED, onChange);
    };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => setToasts((cur) => cur.filter((c) => c.id !== t.id)), TOAST_MS[t.tone]),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  useEffect(() => {
    if (confirmRequest) confirmButtonRef.current?.focus();
  }, [confirmRequest]);

  const settle = (value: boolean | "alt") => {
    confirmRequest?.resolve(value);
    setConfirmRequest(null);
  };

  return (
    <>
      {toasts.length > 0 && (
        // z-[110] deliberately beats the confirm dialog's z-[100] backdrop:
        // the most common source of an error toast is confirming an action.
        <div
          className="pointer-events-none fixed bottom-[var(--space-lg)] left-1/2 z-[110] flex w-full max-w-sm -translate-x-1/2 flex-col gap-[var(--space-sm)] px-[var(--space-md)]"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((toast) => {
            const Icon = TOAST_ICON[toast.tone];
            return (
              <div
                key={toast.id}
                role={toast.tone === "error" ? "alert" : "status"}
                className="pointer-events-auto flex items-start gap-[var(--space-sm)] rounded-lg border border-border bg-white p-[var(--space-md)] shadow-xl"
              >
                <Icon size={18} strokeWidth={2} className={`mt-0.5 shrink-0 ${TOAST_ICON_CLASS[toast.tone]}`} />
                <p className="min-w-0 flex-1 whitespace-pre-line text-body-sm text-text-primary">{toast.message}</p>
                <button
                  type="button"
                  onClick={() => setToasts((cur) => cur.filter((c) => c.id !== toast.id))}
                  aria-label="Dismiss"
                  className="-m-1 shrink-0 rounded p-1 text-text-secondary hover:bg-background-alt"
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {confirmRequest && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black/40 p-[var(--space-lg)]"
          onClick={() => settle(false)}
          onKeyDown={(e) => e.key === "Escape" && settle(false)}
        >
          <div
            className="w-full max-w-sm cursor-auto rounded-lg bg-white p-[var(--space-lg)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-[var(--space-sm)]">
              {confirmRequest.tone === "destructive" && (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error/10">
                  <AlertTriangle size={20} strokeWidth={2} className="text-error" />
                </span>
              )}
              <div className="min-w-0">
                <h2 id="confirm-dialog-title" className="text-h3 font-bold text-text-primary">
                  {confirmRequest.title}
                </h2>
                <p id="confirm-dialog-message" className="mt-[var(--space-xs)] whitespace-pre-line text-body-sm text-text-secondary">
                  {confirmRequest.message}
                </p>
              </div>
            </div>

            <div className="mt-[var(--space-lg)] flex justify-end gap-[var(--space-sm)]">
              <Button variant="outline" size="sm" onClick={() => settle(false)}>
                {confirmRequest.cancelLabel}
              </Button>
              {confirmRequest.altLabel && (
                <Button variant="outline" size="sm" onClick={() => settle("alt")}>
                  {confirmRequest.altLabel}
                </Button>
              )}
              <Button
                ref={confirmButtonRef}
                variant={confirmRequest.tone === "destructive" ? "danger" : "primary"}
                size="sm"
                onClick={() => settle(true)}
              >
                {confirmRequest.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
