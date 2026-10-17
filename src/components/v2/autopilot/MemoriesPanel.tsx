"use client";

import { Brain, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { Modal, RoleInfoBanner } from "@/components/v2/ui";

import { MEMORY_SCOPES, type AiMemory } from "./mockData";

const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";
const FIELD_TEXTAREA_CLASS =
  "mt-[var(--space-xs)] min-h-[110px] w-full rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

interface MemoriesPanelProps {
  memories: AiMemory[];
  onChange: (memories: AiMemory[]) => void;
}

interface EditorState {
  /** null = adding a new memory. */
  id: string | null;
  rule: string;
  scope: string;
}

export function MemoriesPanel({ memories, onChange }: MemoriesPanelProps) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const proposed = memories.filter((m) => m.status === "proposed");
  const active = memories.filter((m) => m.status === "active");

  const openEditor = (memory?: AiMemory) => {
    setFormError("");
    setEditor(memory ? { id: memory.id, rule: memory.rule, scope: memory.scope } : { id: null, rule: "", scope: MEMORY_SCOPES[0] });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
  };

  const accept = (memory: AiMemory) => {
    notifyBackendPending("Accept memory");
    onChange(memories.map((m) => (m.id === memory.id ? { ...m, status: "active" } : m)));
    showToast("Memory accepted. It applies to new documents from now on.", "success");
  };

  const dismiss = (memory: AiMemory) => {
    notifyBackendPending("Dismiss memory");
    onChange(memories.filter((m) => m.id !== memory.id));
    showToast("Suggestion dismissed.", "neutral");
  };

  const remove = async (memory: AiMemory) => {
    const confirmed = await confirmDialog({
      title: "Delete this memory?",
      message: "New documents won't follow this rule any more. Documents already published aren't changed.",
      confirmLabel: beLabel("Delete"),
      tone: "destructive",
    });
    if (!confirmed) return;
    notifyBackendPending("Delete memory");
    onChange(memories.filter((m) => m.id !== memory.id));
    showToast("Memory deleted.", "neutral");
  };

  const save = () => {
    if (!editor) return;
    const rule = editor.rule.trim();
    if (rule.length < 8) {
      setFormError("Describe the rule in a short sentence.");
      return;
    }
    setFormError("");
    setSaving(true);
    notifyBackendPending(editor.id ? "Save memory changes" : "Save memory");
    window.setTimeout(() => {
      if (editor.id) {
        onChange(memories.map((m) => (m.id === editor.id ? { ...m, rule, scope: editor.scope } : m)));
        showToast("Memory updated.", "success");
      } else {
        onChange([{ id: `mem-${Date.now()}`, rule, scope: editor.scope, status: "active", source: "Added by you" }, ...memories]);
        showToast("Memory saved.", "success");
      }
      setSaving(false);
      setEditor(null);
    }, 400);
  };

  const renderMemory = (memory: AiMemory) => (
    <article
      key={memory.id}
      className="flex flex-col gap-[var(--space-sm)] rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[var(--space-xs)]">
          <Badge variant={memory.status === "active" ? "success" : "warning"}>{memory.status === "active" ? "Active" : "Proposed"}</Badge>
          <span className="text-caption text-content-secondary">
            {memory.scope} · {memory.source}
          </span>
        </div>
        <p className="mt-[var(--space-xs)] text-body-sm font-semibold text-content-primary">{memory.rule}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-[var(--space-xs)]">
        {memory.status === "proposed" ? (
          <>
            <Button size="sm" onClick={() => accept(memory)}>
              {beLabel("Accept")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => dismiss(memory)}>
              {beLabel("Dismiss")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => remove(memory)}>
            {beLabel("Delete")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => openEditor(memory)} aria-label="Edit memory">
          <Pencil size={14} strokeWidth={2.25} />
          Edit
        </Button>
      </div>
    </article>
  );

  return (
    <div className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-md)]">
        <p className="max-w-2xl text-body-sm text-content-secondary">
          When you correct a document the same way more than once, Scantrix suggests a memory. Accepted memories are applied to
          every new document before the Autopilot checks run.
        </p>
        <Button size="sm" onClick={() => openEditor()} className="shrink-0">
          <Plus size={16} strokeWidth={2.5} />
          Add memory
        </Button>
      </div>

      <RoleInfoBanner>Tax code corrections aren&apos;t learned automatically. To change tax coding, add a memory yourself.</RoleInfoBanner>

      {memories.length === 0 ? (
        <EmptyState
          icon={<Brain size={28} strokeWidth={1.75} />}
          title="No memories yet"
          description="Memories appear here as you correct documents, or you can add one in plain language."
          actionLabel="Add memory"
          onAction={() => openEditor()}
        />
      ) : (
        <>
          {proposed.length > 0 && (
            <section>
              <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">
                Suggested ({proposed.length})
              </p>
              <div className="flex flex-col gap-[var(--space-sm)]">{proposed.map(renderMemory)}</div>
            </section>
          )}
          {active.length > 0 && (
            <section>
              <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">Active ({active.length})</p>
              <div className="flex flex-col gap-[var(--space-sm)]">{active.map(renderMemory)}</div>
            </section>
          )}
        </>
      )}

      <Modal
        open={editor !== null}
        onClose={closeEditor}
        title={editor?.id ? "Edit memory" : "Add memory"}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeEditor} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} loading={saving} disabled={saving}>
              {beLabel(editor?.id ? "Save" : "Save memory")}
            </Button>
          </>
        }
      >
        {editor && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <label htmlFor="memory-rule" className={FIELD_LABEL_CLASS}>
                Rule *
              </label>
              <textarea
                id="memory-rule"
                value={editor.rule}
                onChange={(e) => setEditor((s) => (s ? { ...s, rule: e.target.value } : s))}
                placeholder='e.g. "Receipts from parking garages go to Travel."'
                disabled={saving}
                className={FIELD_TEXTAREA_CLASS}
              />
              <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Write it the way you&apos;d explain it to a colleague.</p>
            </div>
            <div>
              <label htmlFor="memory-scope" className={FIELD_LABEL_CLASS}>
                Applies to
              </label>
              <select
                id="memory-scope"
                value={editor.scope}
                onChange={(e) => setEditor((s) => (s ? { ...s, scope: e.target.value } : s))}
                disabled={saving}
                className={FIELD_INPUT_CLASS}
              >
                {MEMORY_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </select>
            </div>
            {formError && <p className="text-caption font-semibold text-status-danger-text">{formError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
