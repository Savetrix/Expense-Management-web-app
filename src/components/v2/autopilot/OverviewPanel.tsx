"use client";

import { Eye, FileCheck2, History, Zap } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { RoleInfoBanner } from "@/components/v2/ui";

interface OverviewPanelProps {
  companyName: string;
  providerName: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  stats: { processed: number | null; autopublished: number | null; rate: number | null; waiting: number | null };
  onShowWaiting: () => void;
}

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

const CHECK_CARDS = [
  {
    icon: Eye,
    title: "Legibility",
    body: "Every document is read twice, independently. Autopilot only continues when both reads agree on every field.",
  },
  {
    icon: FileCheck2,
    title: "Completeness",
    body: "Date, due date, reference, amount, GL account and tax are all present; the lines add up to the total; the vendor already exists; and it's an invoice, receipt or credit note.",
  },
  {
    icon: History,
    title: "Historical consistency",
    body: "At least 3 similar past postings agree on the vendor, GL account, tax code and where it was posted. Recent postings count for more than old or edited ones.",
  },
];

export function OverviewPanel({ companyName, providerName, enabled, onEnabledChange, stats, onShowWaiting }: OverviewPanelProps) {
  const [saving, setSaving] = useState(false);

  const handleToggle = async (next: boolean) => {
    if (!next) {
      const confirmed = await confirmDialog({
        title: "Turn off Autopilot?",
        message: `New documents for ${companyName} will wait in review until someone publishes them. Nothing already published changes.`,
        confirmLabel: beLabel("Turn off"),
        tone: "destructive",
      });
      if (!confirmed) return;
    }
    setSaving(true);
    notifyBackendPending("Save Autopilot setting");
    window.setTimeout(() => {
      onEnabledChange(next);
      setSaving(false);
      showToast(next ? "Autopilot is on." : "Autopilot is off.", next ? "success" : "neutral");
    }, 500);
  };

  const statItems = [
    { label: "Documents processed", value: fmt(stats.processed) },
    { label: "Autopublished", value: fmt(stats.autopublished) },
    { label: "Autopublish rate", value: stats.rate === null ? "—" : `${stats.rate}%` },
    { label: "Waiting for review", value: fmt(stats.waiting), onClick: onShowWaiting },
  ];

  return (
    <div className="flex flex-col gap-[var(--space-lg)] p-[var(--space-md)]">
      <div className="flex flex-col gap-[var(--space-md)] rounded-lg border border-border bg-page p-[var(--space-md)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-[var(--space-md)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-bg text-accent-text-on-bg">
            <Zap size={20} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-[var(--space-xs)]">
              <p className="text-h3 font-bold text-content-primary">Autopilot</p>
              <Badge variant={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
            </div>
            <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">
              When every check passes, documents for {companyName} are published to {providerName} without waiting for review.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[var(--space-sm)]">
          {saving && <Spinner size="sm" />}
          <span className="text-caption font-semibold text-content-secondary">{beLabel(enabled ? "On" : "Off")}</span>
          <Switch checked={enabled} onChange={handleToggle} disabled={saving} label={beLabel("Autopilot")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[var(--space-md)] lg:grid-cols-4">
        {statItems.map((item) => {
          const content = (
            <>
              <p className="text-caption text-content-secondary">{item.label}</p>
              <p className="mt-[var(--space-xs)] text-h2 font-bold text-content-primary">{item.value}</p>
            </>
          );
          return item.onClick ? (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="rounded-lg border border-border bg-surface p-[var(--space-md)] text-left hover:bg-surface-alt"
            >
              {content}
            </button>
          ) : (
            <div key={item.label} className="rounded-lg border border-border bg-surface p-[var(--space-md)]">
              {content}
            </div>
          );
        })}
      </div>

      <div>
        <p className="text-body font-bold text-content-primary">Three checks before anything is published</p>
        <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">
          A document is autopublished only when all three pass. If any one fails, it goes to Needs review with the reason.
        </p>
        <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-md)] md:grid-cols-3">
          {CHECK_CARDS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-alt text-content-secondary">
                <Icon size={18} strokeWidth={2} />
              </span>
              <p className="mt-[var(--space-sm)] text-body-sm font-bold text-content-primary">{title}</p>
              <p className="mt-[var(--space-xs)] text-caption text-content-secondary">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <RoleInfoBanner>
        Expense claims are never autopublished — they always wait for a person. Documents from a new vendor also wait until
        there&apos;s enough history to be confident.
      </RoleInfoBanner>
    </div>
  );
}
