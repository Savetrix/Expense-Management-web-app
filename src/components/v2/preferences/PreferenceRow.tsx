"use client";

import { ReactNode } from "react";

import { Switch } from "@/components/ui/Switch";

interface PreferenceRowProps {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  saving: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}

// Shared row shell for PreferencesContentV2 and PreferencesDialogV2 — same
// three toggles rendered either as a standalone page or in place inside a
// Modal from ProfileContentV2.
export function PreferenceRow({ icon, title, description, checked, saving, disabled, onToggle }: PreferenceRowProps) {
  return (
    <div className="flex items-start justify-between gap-[var(--space-md)] p-[var(--space-lg)]">
      <div className="flex min-w-0 items-start gap-[var(--space-sm)]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-bg text-accent">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="font-bold text-content-primary">{title}</p>
          <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onChange={onToggle} disabled={disabled || saving} label={title} />
    </div>
  );
}
