"use client";

import Link from "next/link";
import { Archive, AtSign, FileStack, Plus, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal, TextInput } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

// Front-end-only: the allow-list lives in component state until an endpoint
// exists. "Save" is a (BE) action.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN_RE = /^@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Accepts a full email address or an @domain.tld entry. */
export function isValidSenderEntry(value: string): boolean {
  const v = value.trim().toLowerCase();
  return EMAIL_RE.test(v) || DOMAIN_RE.test(v);
}

const MOCK_SENDERS = ["billing@acme-supplies.com", "@officeworks.example"];

const SUPPORTED_FILES: string[] = [
  "PDF, images (JPG, PNG, HEIC), Word and Excel files",
  "Up to 20 MB per file",
  "Up to 20 attachments per email",
  "A PDF with several invoices is split automatically when each invoice starts on a new page",
];

interface AllowedSendersModalProps {
  open: boolean;
  onClose: () => void;
}

export function SupportedFilesInfo() {
  return (
    <div className="rounded-md border border-border bg-surface-alt p-[var(--space-md)]">
      <p className="mb-[var(--space-sm)] flex items-center gap-[var(--space-xs)] text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">
        <FileStack size={13} strokeWidth={2.25} />
        Supported files
      </p>
      <ul className="flex list-disc flex-col gap-[var(--space-xs)] pl-[var(--space-md)] text-caption text-content-secondary">
        {SUPPORTED_FILES.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          Emails that aren&apos;t financial documents are archived with a reason.{" "}
          <Link href="/archive" className="inline-flex items-center gap-1 font-bold text-accent hover:underline">
            <Archive size={12} strokeWidth={2.25} />
            View archive
          </Link>
        </li>
      </ul>
    </div>
  );
}

export function AllowedSendersModal({ open, onClose }: AllowedSendersModalProps) {
  const [senders, setSenders] = useState<string[]>(MOCK_SENDERS);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  const handleAdd = () => {
    const value = draft.trim().toLowerCase();
    if (!isValidSenderEntry(value)) {
      setError("Enter an email (name@company.com) or a domain (@company.com).");
      return;
    }
    if (senders.includes(value)) {
      setError("That sender is already on the list.");
      return;
    }
    setSenders((prev) => [...prev, value]);
    setDraft("");
    setError("");
    setDirty(true);
  };

  const handleRemove = (entry: string) => {
    setSenders((prev) => prev.filter((s) => s !== entry));
    setDirty(true);
  };

  const handleSave = () => {
    notifyBackendPending("Save allowed senders");
    setDirty(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClassName="max-w-lg"
      ariaLabel="Allowed senders"
      title={
        <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
            <ShieldCheck size={18} strokeWidth={2} className="text-content-secondary" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">Email capture</span>
            <span className="truncate text-h3 font-bold text-content-primary">Allowed senders</span>
          </span>
        </span>
      }
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={!dirty}>
            {beLabel("Save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <p className="text-body-sm text-content-secondary">
          Leave this list empty to process every email sent to your forwarding address. Once it has entries, only
          emails from these senders are processed — everything else is skipped.
        </p>

        <div>
          <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">
            Senders ({senders.length})
          </p>
          {senders.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-[var(--space-md)] py-[var(--space-sm)] text-caption text-content-muted">
              No restrictions — all senders are processed.
            </p>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-md border border-border">
              {senders.map((entry) => (
                <li
                  key={entry}
                  className="flex items-center gap-[var(--space-sm)] border-b border-border px-[var(--space-md)] py-[var(--space-xs)] last:border-b-0"
                >
                  <AtSign size={14} strokeWidth={2} className="shrink-0 text-content-muted" />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-content-primary">{entry}</span>
                  <span className="shrink-0 text-tiny text-content-muted">{entry.startsWith("@") ? "Domain" : "Email"}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(entry)}
                    aria-label={`Remove ${entry}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt hover:text-status-danger-text"
                  >
                    <X size={14} strokeWidth={2.25} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          className="flex items-start gap-[var(--space-sm)]"
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
        >
          <div className="min-w-0 flex-1">
            <TextInput
              name="allowed-sender"
              aria-label="Add sender email or domain"
              placeholder="name@company.com or @company.com"
              value={draft}
              error={error}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError("");
              }}
            />
          </div>
          <Button type="submit" variant="outline" className="shrink-0">
            <Plus size={14} strokeWidth={2.25} />
            Add
          </Button>
        </form>

        <SupportedFilesInfo />
      </div>
    </Modal>
  );
}
