"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface ComboboxOption {
  id: string;
  label: string;
}

interface CreatableComboboxProps {
  options: ComboboxOption[];
  /** What is being picked, lower-case — used in the add row ("vendor", "GL account"). */
  noun: string;
  ariaLabel: string;
  /** id of the selected option, or "" for none. */
  value: string;
  onSelect: (id: string) => void;
  /** Called with the typed text (may be empty) when "Add new vendor" is picked. */
  /** Omit when new entries can't be created here — the add row is then hidden. */
  onAddNew?: (name: string) => void;
  /** Closed-state text shown when nothing in `options` is selected (e.g. "Multiple GLs selected"). Not a list option. */
  valueLabel?: string;
  /** When set, a row with this label clears the selection (for optional fields). */
  clearLabel?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  /** "sm" (default) is the compact 32px inline-field size; "md" matches the 50px form inputs. */
  uiSize?: "sm" | "md";
  className?: string;
}

// Type-to-filter picker (vendors, GL accounts). Replaces a native <select>
// so the list can be searched and so a name that isn't in it can go straight
// to "Add this as new <noun>" with the typed text carried over.
export function CreatableCombobox({
  options,
  noun,
  ariaLabel,
  value,
  onSelect,
  onAddNew,
  clearLabel,
  valueLabel,
  error,
  disabled,
  placeholder = `Select or type a ${noun}`,
  uiSize = "sm",
  className = "",
}: CreatableComboboxProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.id === value) || null;
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  const matches = useMemo(
    () => (lower ? options.filter((o) => o.label?.toLowerCase().includes(lower)) : options),
    [options, lower],
  );
  const exactMatch = options.some((o) => o.label?.trim().toLowerCase() === lower);

  // Row 0 is always the add-new action; vendor rows follow.
  const showAddRow = !!onAddNew && (!trimmed || !exactMatch);
  const showClearRow = !!clearLabel && !!value && !trimmed;
  const leadCount = (showAddRow ? 1 : 0) + (showClearRow ? 1 : 0);
  const clearIndex = showAddRow ? 1 : 0;
  const addLabel = trimmed ? `Add "${trimmed}" as new ${noun}` : `Add new ${noun}`;
  const rowCount = leadCount + matches.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const pick = (index: number) => {
    if (showAddRow && index === 0) {
      const name = trimmed;
      close();
      onAddNew?.(name);
      return;
    }
    if (showClearRow && index === clearIndex) {
      close();
      onSelect("");
      return;
    }
    const option = matches[index - leadCount];
    if (!option) return;
    close();
    onSelect(option.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && rowCount > 0) {
        e.preventDefault();
        pick(active);
      }
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <div ref={rootRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          disabled={disabled}
          // Closed: show the chosen vendor. Open: show what's being typed.
          value={open ? query : selected?.label || valueLabel || ""}
          placeholder={selected && open ? selected.label : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={`${
            uiSize === "md"
              ? "h-[50px] pl-[var(--space-md)] pr-10 text-body"
              : "h-8 pl-[var(--space-sm)] pr-7 text-caption"
          } w-full truncate rounded-md border bg-surface font-semibold text-content-primary placeholder:font-normal placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60 ${
            error ? "border-status-danger-border bg-status-danger-bg" : "border-border"
          }`}
        />
        <ChevronDown
          size={uiSize === "md" ? 16 : 12}
          strokeWidth={2}
          className={`pointer-events-none absolute ${uiSize === "md" ? "right-4" : "right-2.5"} top-1/2 -translate-y-1/2 text-content-secondary transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {showAddRow && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(0)}
              onMouseEnter={() => setActive(0)}
              className={`flex cursor-pointer items-center gap-[var(--space-xs)] border-b border-border px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-accent ${
                active === 0 ? "bg-surface-alt" : ""
              }`}
            >
              <Plus size={12} strokeWidth={2.25} className="shrink-0" />
              <span className="truncate">{addLabel}</span>
            </li>
          )}
          {showClearRow && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(clearIndex)}
              onMouseEnter={() => setActive(clearIndex)}
              className={`cursor-pointer border-b border-border px-[var(--space-sm)] py-[var(--space-xs)] text-caption italic text-content-secondary ${
                active === clearIndex ? "bg-surface-alt" : ""
              }`}
            >
              {clearLabel}
            </li>
          )}
          {matches.map((option, i) => {
            const index = i + leadCount;
            const isSelected = option.id === value;
            return (
              <li
                key={option.id}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(index)}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center justify-between gap-[var(--space-sm)] px-[var(--space-sm)] py-[var(--space-xs)] text-caption text-content-primary ${
                  active === index ? "bg-surface-alt" : ""
                } ${isSelected ? "font-bold" : ""}`}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && <Check size={12} strokeWidth={2.25} className="shrink-0 text-accent" />}
              </li>
            );
          })}
          {matches.length === 0 && trimmed && (
            <li className="px-[var(--space-sm)] py-[var(--space-xs)] text-[11px] text-content-secondary">
              No {noun}s match &ldquo;{trimmed}&rdquo;.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
