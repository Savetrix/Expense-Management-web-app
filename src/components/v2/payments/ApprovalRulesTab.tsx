"use client";

import { Mail, Plus } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Avatar, TextInput } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";

import type { ApprovalMode, ApprovalRules, TeamMember } from "./mockData";
import { CARD_CLASS, FIELD_LABEL_CLASS, delay, mockId, money } from "./shared";

interface ApprovalRulesTabProps {
  rules: ApprovalRules;
  team: TeamMember[];
  onSave: (rules: ApprovalRules, team: TeamMember[]) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ApprovalRulesTab({ rules, team, onSave }: ApprovalRulesTabProps) {
  const [enabled, setEnabled] = useState(rules.enabled);
  const [mode, setMode] = useState<ApprovalMode>(rules.mode);
  const [threshold, setThreshold] = useState(String(rules.threshold));
  const [approverIds, setApproverIds] = useState<string[]>(rules.approverIds);
  const [members, setMembers] = useState<TeamMember[]>(team);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleApprover = (id: string) =>
    setApproverIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addByEmail = () => {
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    const existing = members.find((m) => m.email.toLowerCase() === value);
    if (existing) {
      setApproverIds((prev) => (prev.includes(existing.id) ? prev : [...prev, existing.id]));
    } else {
      const member: TeamMember = { id: mockId("tm"), name: value, email: value, role: "External approver" };
      setMembers((prev) => [...prev, member]);
      setApproverIds((prev) => [...prev, member.id]);
    }
    setEmail("");
    setEmailError("");
  };

  const handleSave = async () => {
    const amount = Number(threshold);
    if (enabled && mode === "above" && (!threshold.trim() || Number.isNaN(amount) || amount <= 0)) {
      setError("Enter an amount above zero.");
      return;
    }
    if (enabled && approverIds.length === 0) {
      setError("Pick at least one approver.");
      return;
    }
    setError("");
    setSaving(true);
    await delay();
    onSave({ enabled, mode, threshold: Number.isNaN(amount) ? rules.threshold : amount, approverIds }, members);
    setSaving(false);
    notifyBackendPending("Save rules");
    showToast(enabled ? "Approval rules saved — new payment runs follow them." : "Approvals turned off.", "success");
  };

  return (
    <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-md)] lg:grid-cols-3">
      <section className={`${CARD_CLASS} lg:col-span-2`}>
        <div className="flex items-start justify-between gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)]">
          <div>
            <h2 className="text-h3 font-bold text-content-primary">Require approval for payments</h2>
            <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">
              Set your limits and approvers once — every payment run is checked against them.
            </p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label="Require approval for payments" />
        </div>

        <div className={`flex flex-col gap-[var(--space-lg)] p-[var(--space-md)] ${enabled ? "" : "pointer-events-none opacity-60"}`} aria-disabled={!enabled}>
          <fieldset>
            <legend className={FIELD_LABEL_CLASS}>When is approval needed?</legend>
            <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-sm)]">
              <label className="flex items-center gap-[var(--space-sm)] text-body-sm text-content-primary">
                <input type="radio" name="approval-mode" checked={mode === "every"} onChange={() => setMode("every")} disabled={!enabled} />
                Every payment
              </label>
              <label className="flex flex-wrap items-center gap-[var(--space-sm)] text-body-sm text-content-primary">
                <input type="radio" name="approval-mode" checked={mode === "above"} onChange={() => setMode("above")} disabled={!enabled} />
                Only payments above
              </label>
              {mode === "above" && (
                <div className="ml-[var(--space-lg)] max-w-xs">
                  <TextInput
                    aria-label="Approval threshold"
                    inputMode="decimal"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    disabled={!enabled}
                  />
                  {Number(threshold) > 0 && (
                    <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Bills over {money(Number(threshold))} need sign-off.</p>
                  )}
                </div>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend className={FIELD_LABEL_CLASS}>Approvers</legend>
            <p className="text-caption text-content-secondary">Any one of them can approve.</p>
            <div className="mt-[var(--space-sm)] flex flex-col gap-[var(--space-sm)]">
              {members.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center justify-between gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] ${
                    approverIds.includes(m.id) ? "border-accent bg-surface-alt" : "border-border bg-page"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
                    <input
                      type="checkbox"
                      checked={approverIds.includes(m.id)}
                      onChange={() => toggleApprover(m.id)}
                      disabled={!enabled}
                      className="rounded border-border-strong text-accent focus:ring-accent"
                    />
                    <Avatar name={m.name} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">{m.name}</span>
                      <span className="block truncate text-caption text-content-secondary">{m.email}</span>
                    </span>
                  </span>
                  <Badge variant="neutral" className="hidden shrink-0 sm:inline-flex">
                    {m.role}
                  </Badge>
                </label>
              ))}
            </div>
            <div className="mt-[var(--space-sm)] flex items-end gap-[var(--space-sm)]">
              <div className="min-w-0 flex-1">
                <TextInput
                  label="Add by email"
                  type="email"
                  placeholder="approver@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addByEmail()}
                  error={emailError}
                  disabled={!enabled}
                />
              </div>
              <Button variant="outline" size="md" onClick={addByEmail} disabled={!enabled || !email.trim()} aria-label="Add approver by email" className={emailError ? "mb-[22px]" : ""}>
                <Plus size={18} strokeWidth={2.5} />
              </Button>
            </div>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] border-t border-border px-[var(--space-md)] py-[var(--space-sm)]">
          <p className="text-caption font-semibold text-status-danger-text">{error}</p>
          <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>
            {beLabel("Save rules")}
          </Button>
        </div>
      </section>

      <aside className={`${CARD_CLASS} h-fit p-[var(--space-md)]`}>
        <div className="flex items-start gap-[var(--space-sm)]">
          <Mail size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
          <div className="text-body-sm text-content-secondary">
            <p className="font-semibold text-content-primary">Approve from email</p>
            <p className="mt-[var(--space-xs)]">
              When a payment needs sign-off, approvers get an email with the bill and amount and can approve or reject it right there — no
              login needed. People added by email don&apos;t need a seat on your team.
            </p>
            <p className="mt-[var(--space-sm)]">Bills that were already approved aren&apos;t asked again when they&apos;re paid.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
