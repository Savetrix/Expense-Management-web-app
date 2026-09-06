"use client";

import { Check, Pencil, X } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";

interface InlineEditFieldProps {
  value: string;
  onCommit: (nextValue: string) => void | Promise<void>;
  multiline?: boolean;
  formatDisplay?: (value: string) => string;
  ariaLabel: string;
  className?: string;
}

// Real controlled-component version of the Stitch invoice-review mockup's
// click-to-edit-in-place pattern (startInlineEdit/commitInlineEdit/
// cancelInlineEdit, keyed off global DOM ids). Here the caller owns `value`
// and receives the new value via `onCommit` — no document.getElementById
// lookups, no module-level "which field is open" state.
export function InlineEditField({ value, onCommit, multiline = false, formatDisplay, ariaLabel, className = "" }: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(value);
    setEditing(false);
  };

  const commitEdit = async () => {
    setEditing(false);
    if (draft !== value) {
      await onCommit(draft);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1200);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    // Plain Enter commits single-line fields; multiline fields need Enter
    // for newlines, so they commit on Ctrl/Cmd+Enter instead.
    const isCommitKey = multiline ? (event.key === "Enter" && (event.metaKey || event.ctrlKey)) : event.key === "Enter";
    if (isCommitKey) {
      event.preventDefault();
      void commitEdit();
    }
  };

  if (editing) {
    const sharedClassName =
      "w-full rounded-md border border-accent bg-surface px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40";
    return (
      <div className={`flex items-start gap-[var(--space-xs)] ${className}`}>
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            aria-label={ariaLabel}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className={sharedClassName}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            aria-label={ariaLabel}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            className={sharedClassName}
          />
        )}
        <button
          type="button"
          aria-label={`Save ${ariaLabel}`}
          onClick={() => void commitEdit()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-status-success-text hover:bg-status-success-bg"
        >
          <Check size={16} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          aria-label={`Cancel editing ${ariaLabel}`}
          onClick={cancelEdit}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-content-muted hover:bg-surface-alt"
        >
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={`Edit ${ariaLabel}`}
      className={`group flex w-full items-center gap-[var(--space-xs)] rounded-md px-[var(--space-xs)] py-[var(--space-xs)] text-left hover:bg-accent-bg/40 ${
        justSaved ? "v2-highlight-flash" : ""
      } ${className}`}
    >
      <span className="min-w-0 flex-1 truncate text-body-sm text-content-primary group-hover:text-accent">
        {formatDisplay ? formatDisplay(value) : value}
      </span>
      <Pencil size={14} strokeWidth={2} className="shrink-0 text-content-muted opacity-0 group-hover:opacity-100" />
    </button>
  );
}
