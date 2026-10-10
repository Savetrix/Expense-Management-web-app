"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Tap-to-insert starter prompts — the chat panel otherwise looks like a plain
// Q&A box with no hint that it can also make changes (create/post/reject/
// sync). Text is inserted into the input for the user to review/edit, never
// auto-sent. Bracketed [placeholders] mark what to fill in; ChatPanel selects
// the first one on insert so typing replaces it immediately.
const GROUPS: { label: string; items: string[] }[] = [
  {
    label: "Look something up",
    items: [
      "Show my pending invoices",
      "How much did I spend this month?",
      "List my active vendors",
      "Show my GL accounts and tax codes",
    ],
  },
  {
    label: "Make a change",
    items: [
      "Create a new vendor named [vendor name] with currency USD",
      "Post invoice [invoice id]",
      "Reject invoice [invoice id] because [reason]",
      "Sync my GL accounts and tax codes",
    ],
  },
];

export function ChatQuickActions({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label="Quick actions"
        aria-expanded={open}
        title="Quick actions"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-background-alt disabled:opacity-60"
      >
        <Sparkles size={18} strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-white py-[var(--space-xs)] shadow-lg">
          {GROUPS.map((group) => (
            <div key={group.label} className="py-[var(--space-xs)]">
              <p className="px-[var(--space-md)] py-[var(--space-xs)] text-caption font-semibold uppercase text-text-secondary">
                {group.label}
              </p>
              {group.items.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                  className="block w-full px-[var(--space-md)] py-[var(--space-sm)] text-left text-body-sm text-text-primary hover:bg-background-alt"
                >
                  {item}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
