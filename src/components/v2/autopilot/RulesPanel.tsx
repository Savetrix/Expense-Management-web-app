"use client";

import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { useBankLookups } from "@/components/v2/bankTransactions/coding";
import { RuleModal, type RuleDraft } from "@/components/v2/bankTransactions/RuleModal";
import { RoleInfoBanner } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { formatPlainDate } from "@/lib/plainDate";
import { taxCodeLabel } from "@/lib/quickbooks/taxCode";
import { ruleSubject } from "@/lib/suggestions/match";
import {
  deleteSuggestionRule,
  fetchSuggestionRules,
  fetchSuggestionSettings,
  saveSuggestionSettings,
  type AutoClassification,
  type SuggestionRuleDto,
  type SuggestionSettingsDto,
} from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

// The company's Smart Suggestions controls: the Auto-classification setting
// and the rules for step 1 ("Always code Esso to Vehicle expense"), both saved
// on the server (lib/bankFeeds/rules.ts). A rule is made from a bank line
// ("Always code like this") or added here.

const KIND_LABEL: Record<SuggestionRuleDto["match"], string> = {
  payee: "Vendor or payee",
  description: "Description",
  category: "Plaid category",
};

const MODES: { value: AutoClassification; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "No suggestions on bank lines or invoices." },
  {
    value: "suggest",
    label: "Suggest only",
    detail: "The vendor, GL and tax boxes stay empty. Sure lines are listed at the top of Bank Transactions, and other ideas appear in each box's dropdown under \"Suggested\".",
  },
  {
    value: "fill",
    label: "Fill in when sure",
    detail: "Sure lines (a rule, or 3 past lines with the same GL and tax) get their vendor, GL and tax filled in, shown with a dashed outline. Nothing is posted until a person clicks Post.",
  },
];

export function RulesPanel({ providerName }: { providerName: string }) {
  const dispatch = useAppDispatch();
  const lookups = useBankLookups();
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const ledgerNames = useAppSelector((s) =>
    s.bankFeeds.ledgerAccountsConnectionId === s.quickBooks.qbConnectionId ? s.bankFeeds.ledgerAccounts : [],
  );
  const [rules, setRules] = useState<SuggestionRuleDto[] | null>(null);
  const [settings, setSettings] = useState<SuggestionSettingsDto | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);

  const load = useCallback(async () => {
    const [result, setting] = await Promise.all([dispatch(fetchSuggestionRules({ check: true })), dispatch(fetchSuggestionSettings())]);
    if (fetchSuggestionSettings.fulfilled.match(setting)) setSettings(setting.payload);
    if (fetchSuggestionRules.fulfilled.match(result)) {
      setRules(result.payload);
      setError("");
    } else {
      setRules([]);
      setError(result.payload?.message ?? "Couldn't load the rules.");
    }
  }, [dispatch]);

  useEffect(() => {
    if (qbConnectionId) void load();
  }, [qbConnectionId, load]);

  const glName = (id: string) => lookups.glById.get(id)?.name ?? ledgerNames.find((a) => a.id === id)?.name;

  const changeMode = async (mode: AutoClassification) => {
    if (!settings || mode === settings.autoClassification) return;
    setSavingMode(true);
    const result = await dispatch(saveSuggestionSettings(mode));
    setSavingMode(false);
    if (!saveSuggestionSettings.fulfilled.match(result)) {
      showToast(result.payload?.message ?? "Couldn't change the setting.", "error");
      return;
    }
    setSettings(result.payload);
    const label = MODES.find((m) => m.value === mode)?.label ?? mode;
    showToast(`Auto-classification is now "${label}". Bank lines to review were updated.`, "success");
  };

  const remove = async (rule: SuggestionRuleDto) => {
    const confirmed = await confirmDialog({
      title: "Delete this rule?",
      message: "Lines it filled in that nobody has posted yet go back to what Scantrix would suggest without it. Posted lines don't change.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;
    const result = await dispatch(deleteSuggestionRule(rule.id));
    if (!deleteSuggestionRule.fulfilled.match(result)) {
      showToast(result.payload?.message ?? "Couldn't delete the rule.", "error");
      return;
    }
    setRules((prev) => (prev ?? []).filter((r) => r.id !== rule.id));
    showToast("Rule deleted.", "neutral");
  };

  const renderRule = (rule: SuggestionRuleDto) => {
    const gl = glName(rule.glAccountId);
    const tax = rule.taxCodeId ? lookups.taxById.get(rule.taxCodeId) : undefined;
    return (
      <article
        key={rule.id}
        className="flex flex-col gap-[var(--space-sm)] rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[var(--space-xs)]">
            <Badge variant={rule.broken ? "error" : "success"}>{rule.broken ? "Account missing" : "Active"}</Badge>
            <span className="text-caption text-content-secondary">
              {KIND_LABEL[rule.match]} · changed {formatPlainDate(rule.updatedAt, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
          <p className="mt-[var(--space-xs)] text-body-sm text-content-primary">
            Always code <span className="font-semibold">{ruleSubject(rule)}</span> to <span className="font-semibold">{gl ?? "an account that isn't in the chart any more"}</span>
            {tax && <> with {taxCodeLabel(tax)}</>}.
          </p>
          {rule.broken && (
            <p className="mt-[var(--space-xs)] text-caption text-status-danger-text">
              This GL account isn&apos;t active in {providerName} any more, so Scantrix skips this rule. Edit it to pick another account.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-[var(--space-xs)]">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft({ id: rule.id, match: rule.match, label: rule.label, glAccountId: rule.broken ? "" : rule.glAccountId, taxCodeId: rule.taxCodeId, category: rule.match === "category" ? rule.label : undefined })}
          >
            <Pencil size={14} strokeWidth={2.25} />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => remove(rule)} aria-label="Delete rule">
            <Trash2 size={14} strokeWidth={2.25} />
            Delete
          </Button>
        </div>
      </article>
    );
  };

  return (
    <div className="flex flex-col gap-[var(--space-md)] p-[var(--space-md)]">
      <section className="rounded-md border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)]">
        <p className="text-body-sm font-bold text-content-primary">Auto-classification</p>
        <p className="text-caption text-content-secondary">
          How Scantrix uses its suggestions for this company: rules and earlier decisions, on bank lines and invoices.
        </p>
        {settings ? (
          <div className="mt-[var(--space-sm)] grid gap-[var(--space-sm)] md:grid-cols-3" role="radiogroup" aria-label="Auto-classification">
            {MODES.map((m) => {
              const checked = settings.autoClassification === m.value;
              return (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-start gap-[var(--space-xs)] rounded-md border px-[var(--space-sm)] py-[var(--space-xs)] ${
                    checked ? "border-accent bg-surface-alt" : "border-border"
                  } ${!settings.canChange || savingMode ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <input
                    type="radio"
                    name="auto-classification"
                    className="mt-1"
                    checked={checked}
                    disabled={!settings.canChange || savingMode}
                    onChange={() => changeMode(m.value)}
                  />
                  <span>
                    <span className="block text-body-sm font-semibold text-content-primary">{m.label}</span>
                    <span className="block text-caption text-content-secondary">{m.detail}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="mt-[var(--space-sm)]">
            <SkeletonListRows count={1} />
          </div>
        )}
        {settings && !settings.canChange && <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Only an Owner or Admin can change this.</p>}
      </section>

      <div className="flex flex-wrap items-start justify-between gap-[var(--space-md)]">
        <p className="max-w-2xl text-body-sm text-content-secondary">
          Rules come first. When a bank line matches a rule, Scantrix fills in its GL account and tax code, even for a payee it has never seen.
          On an invoice, a vendor rule is offered next to the GL account. A person still presses Post. Make a rule from any bank line with
          &quot;Always code like this&quot;, or add one here.
        </p>
        <Button size="sm" onClick={() => setDraft({ match: "payee", label: "", glAccountId: "", taxCodeId: null })} className="shrink-0">
          <Plus size={16} strokeWidth={2.5} />
          Add rule
        </Button>
      </div>

      {error && <RoleInfoBanner>{error}</RoleInfoBanner>}
      {settings?.autoClassification === "off" && (rules?.length ?? 0) > 0 && (
        <RoleInfoBanner>Auto-classification is Off, so Scantrix doesn&apos;t use these rules until it is turned back on.</RoleInfoBanner>
      )}

      {rules === null ? (
        <SkeletonListRows count={3} />
      ) : rules.length === 0 ? (
        !error && (
          <EmptyState
            icon={<ListChecks size={28} strokeWidth={1.75} />}
            title="No rules yet"
            description='Open a bank line, pick its GL account, and press "Always code like this". Or add a rule here.'
            actionLabel="Add rule"
            onAction={() => setDraft({ match: "payee", label: "", glAccountId: "", taxCodeId: null })}
          />
        )
      ) : (
        <section>
          <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-wider text-content-muted">
            Rules ({rules.length}) · a vendor or payee rule comes before a description or category rule
          </p>
          <div className="flex flex-col gap-[var(--space-sm)]">{rules.map(renderRule)}</div>
        </section>
      )}

      <RuleModal draft={draft} lookups={lookups} onClose={() => setDraft(null)} onSaved={() => void load()} />
    </div>
  );
}
