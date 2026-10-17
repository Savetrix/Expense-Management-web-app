"use client";

import { Check, ChevronDown, Copy, Link2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

// Front-end-only permission presets. No permissions API exists yet, so the
// state lives here and "Save" / "Create invite link" are (BE) actions.

export type PermissionPreset = "full" | "read_upload" | "read_own_upload" | "custom";

interface PermissionDef {
  key: string;
  label: string;
}

interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "invoices",
    label: "Invoices & bills",
    permissions: [
      { key: "invoices.view_all", label: "View all" },
      { key: "invoices.view_own", label: "View own" },
      { key: "invoices.publish", label: "Publish" },
      { key: "invoices.delete", label: "Delete" },
    ],
  },
  {
    key: "documents",
    label: "Documents",
    permissions: [{ key: "documents.upload", label: "Upload" }],
  },
  {
    key: "expense_claims",
    label: "Expense claims",
    permissions: [
      { key: "expense_claims.view_all", label: "View all" },
      { key: "expense_claims.view_own", label: "View own" },
      { key: "expense_claims.create", label: "Create" },
      { key: "expense_claims.publish", label: "Publish" },
      { key: "expense_claims.delete", label: "Delete" },
    ],
  },
  {
    key: "month_end",
    label: "Month-end adjustments",
    permissions: [
      { key: "month_end.view_all", label: "View all" },
      { key: "month_end.view_own", label: "View own" },
      { key: "month_end.create", label: "Create" },
      { key: "month_end.publish", label: "Publish" },
      { key: "month_end.delete", label: "Delete" },
    ],
  },
  {
    key: "payments",
    label: "Payments",
    permissions: [
      { key: "payments.view", label: "View" },
      { key: "payments.pay", label: "Pay" },
      { key: "payments.approve", label: "Approve" },
    ],
  },
  {
    key: "company_settings",
    label: "Company settings",
    permissions: [{ key: "company_settings.update", label: "Update" }],
  },
  {
    key: "working_papers",
    label: "Working papers",
    permissions: [
      { key: "working_papers.edit", label: "Edit" },
      { key: "working_papers.manage_periods", label: "Manage periods" },
    ],
  },
];

const ALL_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const PRESET_PERMISSIONS: Record<Exclude<PermissionPreset, "custom">, string[]> = {
  full: ALL_KEYS,
  read_upload: [
    "invoices.view_all",
    "invoices.view_own",
    "documents.upload",
    "expense_claims.view_all",
    "expense_claims.view_own",
    "expense_claims.create",
    "month_end.view_all",
    "month_end.view_own",
    "payments.view",
  ],
  read_own_upload: ["invoices.view_own", "documents.upload", "expense_claims.view_own", "expense_claims.create", "month_end.view_own"],
};

const PRESETS: { key: PermissionPreset; label: string; description: string }[] = [
  { key: "full", label: "Full access", description: "Everything, including publishing, payments and settings." },
  { key: "read_upload", label: "Read + upload only", description: "See all documents and upload new ones. Can't publish." },
  { key: "read_own_upload", label: "Read own + upload only", description: "Only sees what they uploaded. Ideal for staff submitting receipts." },
  { key: "custom", label: "Custom access", description: "Pick individual permissions below." },
];

export function permissionsForPreset(preset: PermissionPreset, current: string[] = []): string[] {
  return preset === "custom" ? current : [...PRESET_PERMISSIONS[preset]];
}

/** Infers the preset a permission set matches; "custom" when none does. */
export function presetFor(permissions: string[]): PermissionPreset {
  const set = new Set(permissions);
  for (const key of ["full", "read_upload", "read_own_upload"] as const) {
    const preset = PRESET_PERMISSIONS[key];
    if (preset.length === set.size && preset.every((p) => set.has(p))) return key;
  }
  return "custom";
}

interface PermissionPresetPickerProps {
  preset: PermissionPreset;
  permissions: string[];
  onChange: (next: { preset: PermissionPreset; permissions: string[] }) => void;
  disabled?: boolean;
  /** Hide the checkbox grid (e.g. in the compact invite step) unless Custom is picked. */
  compact?: boolean;
}

/** Preset radio cards + grouped permission checkboxes. Fully controlled. */
export function PermissionPresetPicker({ preset, permissions, onChange, disabled, compact }: PermissionPresetPickerProps) {
  const selected = new Set(permissions);

  const pickPreset = (next: PermissionPreset) => {
    onChange({ preset: next, permissions: permissionsForPreset(next, permissions) });
  };

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Any manual change switches to Custom, per spec.
    onChange({ preset: "custom", permissions: ALL_KEYS.filter((k) => next.has(k)) });
  };

  const showGrid = !compact || preset === "custom";

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <div role="radiogroup" aria-label="Permission preset" className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
        {PRESETS.map((p) => {
          const isSelected = preset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => pickPreset(p.key)}
              className={`flex items-start justify-between gap-[var(--space-sm)] rounded-lg border-2 px-[var(--space-md)] py-[var(--space-sm)] text-left disabled:opacity-60 ${
                isSelected ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-surface-alt"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-body-sm font-bold text-content-primary">{p.label}</span>
                <span className="block text-caption text-content-secondary">{p.description}</span>
              </span>
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  isSelected ? "border-primary" : "border-border"
                }`}
              >
                {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
            </button>
          );
        })}
      </div>

      {showGrid && (
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          {PERMISSION_GROUPS.map((group) => (
            <fieldset
              key={group.key}
              className="flex flex-col gap-[var(--space-xs)] border-b border-border px-[var(--space-md)] py-[var(--space-sm)] last:border-b-0 sm:flex-row sm:items-start sm:gap-[var(--space-md)]"
            >
              <legend className="sr-only">{group.label}</legend>
              <span aria-hidden className="shrink-0 text-body-sm font-semibold text-content-primary sm:w-44">
                {group.label}
              </span>
              <div className="flex flex-wrap gap-x-[var(--space-md)] gap-y-[var(--space-xs)]">
                {group.permissions.map((perm) => (
                  <label key={perm.key} className="inline-flex cursor-pointer items-center gap-[var(--space-xs)] text-caption text-content-secondary">
                    <input
                      type="checkbox"
                      checked={selected.has(perm.key)}
                      disabled={disabled}
                      onChange={() => toggle(perm.key)}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                    {perm.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

interface MemberPermissionsModalProps {
  open: boolean;
  onClose: () => void;
  memberName: string;
  /** Used to seed a sensible default preset from the existing role. */
  memberRole?: string;
}

function defaultPresetForRole(role?: string): PermissionPreset {
  if (role === "owner" || role === "admin" || role === "accountant") return "full";
  if (role === "contributor") return "read_own_upload";
  return "read_upload";
}

export function MemberPermissionsModal({ open, onClose, memberName, memberRole }: MemberPermissionsModalProps) {
  const initialPreset = defaultPresetForRole(memberRole);
  const [preset, setPreset] = useState<PermissionPreset>(initialPreset);
  const [permissions, setPermissions] = useState<string[]>(() => permissionsForPreset(initialPreset));

  const handleSave = () => {
    notifyBackendPending("Save permissions");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClassName="max-w-2xl"
      ariaLabel={`Permissions for ${memberName}`}
      title={
        <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
            <ShieldCheck size={18} strokeWidth={2} className="text-content-secondary" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">Permissions</span>
            <span className="truncate text-h3 font-bold text-content-primary">{memberName}</span>
          </span>
        </span>
      }
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            {beLabel("Save permissions")}
          </Button>
        </>
      }
    >
      <PermissionPresetPicker
        preset={preset}
        permissions={permissions}
        onChange={(next) => {
          setPreset(next.preset);
          setPermissions(next.permissions);
        }}
      />
    </Modal>
  );
}

/**
 * Optional, collapsed-by-default preset step for the invite sheet. The real
 * invite call doesn't accept permissions yet, so this only records the choice
 * locally and flags it (BE).
 */
export function InvitePermissionsStep({ disabled }: { disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [preset, setPreset] = useState<PermissionPreset>("read_upload");
  const [permissions, setPermissions] = useState<string[]>(() => permissionsForPreset("read_upload"));
  const label = PRESETS.find((p) => p.key === preset)?.label ?? "";

  return (
    <div className="mt-[var(--space-md)] rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-left"
      >
        <span className="min-w-0">
          <span className="block text-body-sm font-semibold text-content-primary">Permissions (optional)</span>
          <span className="block truncate text-caption text-content-secondary">{label}</span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`shrink-0 text-content-secondary transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-border p-[var(--space-md)]">
          <PermissionPresetPicker
            compact
            disabled={disabled}
            preset={preset}
            permissions={permissions}
            onChange={(next) => {
              setPreset(next.preset);
              setPermissions(next.permissions);
            }}
          />
          <p className="mt-[var(--space-sm)] text-caption text-content-muted">
            Applied when the invite is sent {"(BE)"} — not yet saved by the server.
          </p>
        </div>
      )}
    </div>
  );
}

/** "Create invite link" card — mock link with copy and a 14-day expiry note. */
export function InviteLinkPanel({ companyName }: { companyName?: string }) {
  const provider = useActiveProvider();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = () => {
    notifyBackendPending("Create invite link");
    const token = Math.random().toString(36).slice(2, 10);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setLink(`${origin}/join/${token}`);
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!link || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Couldn't copy the link.", "error");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
      <p className="flex items-center gap-[var(--space-xs)] font-bold text-content-primary">
        <Link2 size={16} strokeWidth={2.25} className="text-content-secondary" />
        Invite link
      </p>
      <p className="mt-[2px] text-caption text-content-secondary">
        Share a link so teammates can join {companyName || `this ${provider.companyNoun}`} without an email invite.
      </p>
      {link ? (
        <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-xs)]">
          <div className="flex items-center gap-[var(--space-xs)]">
            <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-alt px-[var(--space-sm)] py-[var(--space-xs)] font-mono text-caption text-content-secondary">
              {link}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label={copied ? "Link copied" : "Copy invite link"}
              className="flex h-8 shrink-0 items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt"
            >
              {copied ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2.5} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-tiny text-content-muted">Expires in 14 days.</p>
          <button type="button" onClick={handleCreate} className="self-start text-caption font-bold text-accent hover:underline">
            {beLabel("Create new link")}
          </button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={handleCreate} className="mt-[var(--space-sm)] w-full">
          {beLabel("Create invite link")}
        </Button>
      )}
    </div>
  );
}
