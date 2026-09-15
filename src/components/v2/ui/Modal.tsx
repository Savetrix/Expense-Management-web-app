"use client";

import { HTMLAttributes, ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Escape hatch for the invoice-review line-item editor's wider form layout. */
  widthClassName?: string;
}

// Generic overlay + panel shell — DialogHost only covers the global
// toast/confirm case (src/lib/dialogManager.ts), so any Stitch screen that
// needs arbitrary modal content (integration connection details, invoice
// review's line-item editor) composes this instead of hand-rolling another
// `hidden`/`flex` class-toggle like the raw mockups do.
export function Modal({ open, onClose, title, children, footer, widthClassName = "max-w-md" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // z-[95] deliberately sits BELOW DialogHost's confirm backdrop (z-[100])
      // and toast stack (z-[110]), and above the chat panel (z-[90]) and every
      // in-page layer (≤ z-50). Modal content routinely raises a
      // confirmDialog of its own — Integrations' Disconnect, and every
      // confirm in the email-forwarding panel nested inside it — and at
      // z-[120] that confirm rendered *behind* this panel, leaving the user
      // with a dimmed, unanswerable dialog. A confirm raised from a modal has
      // to be reachable, which outranks an unrelated toast painting over the
      // panel for a few seconds.
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-[var(--space-md)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onClick={(event) => event.stopPropagation()}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl ${widthClassName}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-[var(--space-lg)] py-[var(--space-md)]">
          <h2 className="text-h3 font-bold text-content-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[var(--space-lg)] py-[var(--space-md)]">{children}</div>

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-[var(--space-sm)] border-t border-border px-[var(--space-lg)] py-[var(--space-md)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface ModalDefinitionRowProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  /** Optional leading glyph beside the label — the Integrations connection
   * detail lists each fact (connected on / realm id / role) with one. */
  icon?: ReactNode;
  children: ReactNode;
}

export function ModalDefinitionRow({ label, icon, children, ...props }: ModalDefinitionRowProps) {
  return (
    <div {...props} className={`flex items-center justify-between gap-[var(--space-md)] border-b border-border py-[var(--space-sm)] last:border-b-0 ${props.className ?? ""}`}>
      <span className="flex min-w-0 items-center gap-[var(--space-xs)] text-body-sm text-content-secondary">
        {icon && <span className="shrink-0 text-content-muted">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex min-w-0 items-center justify-end gap-[var(--space-xs)] text-body-sm font-semibold text-content-primary">
        {children}
      </span>
    </div>
  );
}
