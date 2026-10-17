"use client";

import { FileText, UploadCloud, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CreatableCombobox, Modal, RoleInfoBanner } from "@/components/v2/ui";
import { beLabel } from "@/lib/bePlaceholder";

import { FIELD_LABEL_CLASS } from "./format";

const ACCEPTED_TYPES = "application/pdf,image/png,image/jpeg,image/heic,image/webp";

function isAccepted(file: File): boolean {
  return file.type === "application/pdf" || file.type.startsWith("image/");
}

interface UploadStatementModalProps {
  open: boolean;
  vendors: string[];
  onClose: () => void;
  /** vendor is "" when the user left it for automatic detection. */
  onUpload: (file: File, vendor: string) => void;
}

export function UploadStatementModal({ open, vendors, onClose, onUpload }: UploadStatementModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [vendor, setVendor] = useState("");
  const [extraVendors, setExtraVendors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const options = useMemo(
    () => Array.from(new Set([...vendors, ...extraVendors])).map((name) => ({ id: name, label: name })),
    [vendors, extraVendors],
  );

  const reset = () => {
    setFile(null);
    setVendor("");
    setError("");
    setDragging(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickFile = (picked: File | undefined | null) => {
    if (!picked) return;
    if (!isAccepted(picked)) {
      setError("Upload a PDF or an image (PNG, JPG, HEIC, WEBP).");
      return;
    }
    setError("");
    setFile(picked);
  };

  const submit = () => {
    if (!file) {
      setError("Choose a statement file to upload.");
      return;
    }
    onUpload(file, vendor);
    reset();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload statement"
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!file}>
            <UploadCloud size={16} strokeWidth={2.25} />
            {beLabel("Upload")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex flex-col items-center rounded-lg border-2 border-dashed px-[var(--space-md)] py-[var(--space-lg)] text-center transition-colors ${
            dragging ? "border-accent bg-accent/10" : "border-border bg-page"
          }`}
        >
          <span className="mb-[var(--space-sm)] flex h-12 w-12 items-center justify-center rounded-full bg-accent-bg text-accent-text-on-bg">
            <UploadCloud size={22} strokeWidth={2} />
          </span>
          <p className="text-body-sm font-semibold text-content-primary">Drag a statement here</p>
          <p className="mt-[2px] text-caption text-content-secondary">PDF or image, one statement per file</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-[var(--space-sm)] text-body-sm font-bold text-accent hover:underline"
          >
            Browse files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {file && (
          <div className="flex items-center justify-between gap-[var(--space-sm)] rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)]">
            <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
              <FileText size={18} strokeWidth={2} className="shrink-0 text-content-secondary" />
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-content-primary">{file.name}</span>
                <span className="block text-caption text-content-secondary">{Math.max(1, Math.round(file.size / 1024))} KB</span>
              </span>
            </span>
            <button
              type="button"
              aria-label="Remove file"
              onClick={() => setFile(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        )}

        <div>
          <label className={FIELD_LABEL_CLASS}>Vendor (optional)</label>
          <div className="mt-[var(--space-xs)]">
            <CreatableCombobox
              options={options}
              noun="vendor"
              ariaLabel="Vendor"
              value={vendor}
              onSelect={setVendor}
              onAddNew={(name) => {
                const trimmed = name.trim();
                if (!trimmed) return;
                setExtraVendors((list) => [...list, trimmed]);
                setVendor(trimmed);
              }}
              clearLabel="Detect automatically"
              placeholder="Detect automatically"
              uiSize="md"
            />
          </div>
          <p className="mt-[var(--space-xs)] text-caption text-content-secondary">
            Detected automatically from the statement if left blank.
          </p>
        </div>

        {error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}

        <RoleInfoBanner>
          Statements that arrive by email, or are uploaded anywhere in Scantrix, are recognised and listed here automatically.
        </RoleInfoBanner>
      </div>
    </Modal>
  );
}
