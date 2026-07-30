"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  CONFIRM_REQUEST,
  ConfirmRequest,
  TOAST_REQUEST,
  ToastRequest,
  dialogEmitter,
} from "@/lib/dialogManager";
import { Button } from "@/components/ui/Button";

const TOAST_DURATION_MS = 4000;

const TOAST_ICON = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

const TOAST_ICON_CLASS = {
  success: "text-success",
  error: "text-error",
  info: "text-trust-navy",
} as const;

// Single global subscriber for src/lib/dialogManager.ts's emitter — mounted
// once in Providers so every route (including auth pages) can call
// confirmDialog()/showToast() from a plain event handler with no context
// wiring at the call site. Replaces every window.alert/window.confirm in
// the app; see DESIGN_ASSUMPTIONS.md D1.3.
export function DialogHost() {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<ToastRequest[]>([]);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onConfirm = (request: ConfirmRequest) => setConfirmRequest(request);
    const onToast = (request: ToastRequest) => {
      setToasts((prev) => [...prev, request]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== request.id));
      }, TOAST_DURATION_MS);
    };
    dialogEmitter.on(CONFIRM_REQUEST, onConfirm);
    dialogEmitter.on(TOAST_REQUEST, onToast);
    return () => {
      dialogEmitter.off(CONFIRM_REQUEST, onConfirm);
      dialogEmitter.off(TOAST_REQUEST, onToast);
    };
  }, []);

  useEffect(() => {
    if (confirmRequest) confirmButtonRef.current?.focus();
  }, [confirmRequest]);

  const settle = (value: boolean) => {
    confirmRequest?.resolve(value);
    setConfirmRequest(null);
  };

  return (
    <>
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

      <div className="fixed bottom-[var(--space-lg)] right-[var(--space-lg)] z-[100] flex w-full max-w-sm flex-col gap-[var(--space-sm)]">
        {toasts.map((toast) => {
          const Icon = TOAST_ICON[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              aria-live="polite"
              className="flex items-start gap-[var(--space-sm)] rounded-lg border border-border bg-white p-[var(--space-md)] shadow-xl"
            >
              <Icon size={18} strokeWidth={2} className={`mt-0.5 shrink-0 ${TOAST_ICON_CLASS[toast.tone]}`} />
              <p className="text-body-sm font-medium text-text-primary">{toast.message}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
