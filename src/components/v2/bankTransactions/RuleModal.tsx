"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CreatableCombobox, Modal, SelectDropdown, TextInput } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { taxCodeId, taxCodeLabel } from "@/lib/quickbooks/taxCode";
import { ruleSubject } from "@/lib/suggestions/match";
import { saveSuggestionRule, type SuggestionRuleDto, type SuggestionRuleMatch } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch } from "@/store/hooks";

import type { Lookups } from "./coding";

// "Always code like this": a company rule for Smart Suggestions, step 1
// (lib/bankFeeds/rules.ts). Opened from a bank line, which fills it in, and
// from the Rules tab on Autopilot, to add or change one.

export interface RuleDraft {
  /** Absent for a new rule. */
  id?: string;
  match: SuggestionRuleMatch;
  label: string;
  glAccountId: string;
  taxCodeId: string | null;
  /** Plaid's category of the line the rule starts from, when it has one. */
  category?: string;
}

const MATCH_LABEL: Record<SuggestionRuleMatch, string> = {
  payee: "The vendor or payee is",
  description: "The bank description contains",
  category: "Plaid's category is",
};

interface RuleModalProps {
  draft: RuleDraft | null;
  lookups: Lookups;
  onClose: () => void;
  onSaved?: (rule: SuggestionRuleDto, filled: number) => void;
}

export function RuleModal({ draft, lookups, onClose, onSaved }: RuleModalProps) {
  if (!draft) return null;
  // Keyed so a new draft starts the form afresh.
  return <RuleForm key={draft.id ?? `${draft.match}:${draft.label}`} draft={draft} lookups={lookups} onClose={onClose} onSaved={onSaved} />;
}

function RuleForm({ draft, lookups, onClose, onSaved }: RuleModalProps & { draft: RuleDraft }) {
  const dispatch = useAppDispatch();
  const [match, setMatch] = useState<SuggestionRuleMatch>(draft.match);
  const [label, setLabel] = useState(draft.label);
  const [glAccountId, setGlAccountId] = useState(draft.glAccountId);
  const [tax, setTax] = useState(draft.taxCodeId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const glOptions = useMemo(() => lookups.glAccounts.map((a) => ({ id: a.qbAccountId, label: a.name })), [lookups.glAccounts]);
  const taxOptions = useMemo(() => lookups.taxCodes.map((t) => ({ id: taxCodeId(t), label: taxCodeLabel(t) })), [lookups.taxCodes]);
  const canUseCategory = Boolean(draft.category) || draft.match === "category";
  const glName = glAccountId ? lookups.glById.get(glAccountId)?.name : undefined;
  const taxName = tax ? lookups.taxById.get(tax) : undefined;

  const pickMatch = (next: SuggestionRuleMatch) => {
    setMatch(next);
    if (next === "category" && draft.category) setLabel(draft.category);
    else if (match === "category") setLabel(draft.match === "category" ? "" : draft.label);
  };

  const save = async () => {
    if (!label.trim()) return setError(match === "description" ? "Type the words the description must contain." : "Type the vendor or payee name.");
    if (!glAccountId) return setError("Pick the GL account the rule codes to.");
    setError("");
    setSaving(true);
    const result = await dispatch(saveSuggestionRule({ id: draft.id, input: { match, label: label.trim(), glAccountId, taxCodeId: tax || null } }));
    setSaving(false);
    if (!saveSuggestionRule.fulfilled.match(result)) {
      setError(result.payload?.message ?? "Couldn't save the rule. Try again.");
      return;
    }
    const { rule, filled, autoClassification } = result.payload;
    const lines = `${filled} line${filled === 1 ? "" : "s"} to review`;
    showToast(
      autoClassification === "off"
        ? "Rule saved. Auto-classification is Off, so Scantrix doesn't use rules until an Owner or Admin turns it on (Autopilot → Rules)."
        : filled === 0
          ? "Rule saved. Scantrix uses it for every matching line from now on."
          : autoClassification === "suggest"
            ? `Rule saved. Scantrix suggests it on ${lines}. Nothing is filled in, because Auto-classification is set to Suggest only.`
            : `Rule saved. Scantrix filled in ${lines}. A person still presses Post.`,
      "success",
    );
    onSaved?.(rule, filled);
    onClose();
  };

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title={draft.id ? "Edit rule" : "Always code like this"}
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <SelectDropdown label="When" value={match} onChange={(e) => pickMatch(e.target.value as SuggestionRuleMatch)}>
          {(Object.keys(MATCH_LABEL) as SuggestionRuleMatch[])
            .filter((m) => m !== "category" || canUseCategory)
            .map((m) => (
              <option key={m} value={m}>
                {MATCH_LABEL[m]}
              </option>
            ))}
        </SelectDropdown>
        <TextInput
          label={match === "payee" ? "Vendor or payee, as the bank shows it" : match === "description" ? "Words in the description" : "Category"}
          value={label}
          disabled={match === "category"}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={match === "payee" ? "e.g. Esso" : "e.g. fuel"}
        />
        <div className="flex flex-col gap-[var(--space-xs)]">
          <span className="text-body-sm font-semibold text-content-primary">Code to</span>
          <CreatableCombobox options={glOptions} noun="GL account" ariaLabel="GL account" value={glAccountId} onSelect={setGlAccountId} placeholder="GL account" uiSize="md" />
          {taxOptions.length > 0 && (
            <CreatableCombobox options={taxOptions} noun="tax code" ariaLabel="Tax code" value={tax} onSelect={setTax} clearLabel="No tax code" placeholder="Tax code (optional)" uiSize="md" />
          )}
        </div>
        {label.trim() && glName && (
          <p className="rounded-md border border-border bg-surface-alt px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm text-content-primary">
            Always code <span className="font-semibold">{ruleSubject({ match, label: label.trim() })}</span> to <span className="font-semibold">{glName}</span>
            {taxName && <> with {taxCodeLabel(taxName)}</>}.
          </p>
        )}
        <p className="text-caption text-content-secondary">
          Scantrix fills in matching lines to review straight away and says it was this rule. Nothing is posted until a person presses Post. A
          vendor or payee rule comes before a description or category rule.
        </p>
        {error && <p className="text-caption font-semibold text-status-danger-text">{error}</p>}
      </div>
    </Modal>
  );
}
