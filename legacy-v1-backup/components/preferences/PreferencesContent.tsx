"use client";

import { Paperclip, Rows3, SlidersHorizontal, Zap } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateQuickBooksSettings } from "@/store/quickBooks/quickBooksApi";
import { useQuickBooksConnections } from "@/store/quickBooks/useQuickBooksConnections";

function PreferenceRow({
  icon,
  title,
  description,
  checked,
  saving,
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  saving: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-[var(--space-md)] p-[var(--space-lg)]">
      <div className="flex min-w-0 items-start gap-[var(--space-sm)]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="font-bold text-text-primary">{title}</p>
          <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onChange={onToggle} disabled={disabled || saving} label={title} />
    </div>
  );
}

export function PreferencesContent() {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const autoPostEnabled = useAppSelector((state) => state.quickBooks.autoPostEnabled);
  const lineItemWiseEnabled = useAppSelector((state) => state.quickBooks.lineItemWiseEnabled);
  const attachInvoiceCopyEnabled = useAppSelector((state) => state.quickBooks.attachInvoiceCopyEnabled);

  const [savingAutoPost, setSavingAutoPost] = useState(false);
  const [savingLineItem, setSavingLineItem] = useState(false);
  const [savingAttachInvoiceCopy, setSavingAttachInvoiceCopy] = useState(false);

  const { activeConnections, activeConnectionId, checkingStatus, connecting, handleConnect } =
    useQuickBooksConnections("/preferences");

  // With exactly one connected company there's nothing to choose, so use it
  // directly. With 2+, only use a match for an id the user actually
  // selected — the top-bar switcher starts blank when multiple companies are
  // connected, and this page shouldn't silently pick one on its own.
  const activeConnection =
    activeConnections.length === 1 ? activeConnections[0] : activeConnections.find((c) => c._id === activeConnectionId);
  const currentRole = activeConnection?.role || "";
  // Mirrors the backend's owner/admin-only gate on PATCH /quickbooks/settings.
  const canManage = currentRole === "owner" || currentRole === "admin";

  const handleToggle = async (
    field: "autoPostEnabled" | "lineItemWiseEnabled" | "attachInvoiceCopyEnabled",
    value: boolean,
    setSaving: (v: boolean) => void,
    successLabel: string,
  ) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const result = await dispatch(updateQuickBooksSettings({ accessToken, [field]: value }));
      if (updateQuickBooksSettings.fulfilled.match(result)) {
        showToast(`${successLabel} ${value ? "enabled" : "disabled"}.`, "success");
      } else {
        showToast(typeof result.payload === "string" ? result.payload : "Could not update this setting.", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  if (checkingStatus) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
        <EmptyState
          icon={<SlidersHorizontal size={28} strokeWidth={1.75} />}
          title={activeConnections.length > 0 ? "Select a company" : "No company connected"}
          description={
            activeConnections.length > 0
              ? "Choose a company from the switcher up top to manage its posting preferences."
              : "Connect a QuickBooks company to manage posting preferences."
          }
          actionLabel={activeConnections.length > 0 ? undefined : connecting ? "Connecting…" : "Connect QuickBooks"}
          onAction={activeConnections.length > 0 ? undefined : handleConnect}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
      <h1 className="text-h2 font-bold text-trust-navy">Preferences</h1>
      <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
        Control how invoices post to QuickBooks for {activeConnection.name}.
      </p>

      {!canManage && (
        <Card className="mt-[var(--space-md)] text-body-sm text-text-secondary">
          You have {currentRole || "limited"} access on {activeConnection.name} and can view these preferences but not
          change them. Ask an owner or admin to update them.
        </Card>
      )}

      <div className="mt-[var(--space-lg)] divide-y divide-border overflow-hidden rounded-lg border border-border bg-white">
        <PreferenceRow
          icon={<Rows3 size={18} strokeWidth={2} />}
          title="Line item wise Entry"
          description="Book every extracted invoice line item as its own line in the QuickBooks entry. When off, each invoice posts as a single consolidated line."
          checked={lineItemWiseEnabled}
          saving={savingLineItem}
          disabled={!canManage}
          onToggle={(value) => handleToggle("lineItemWiseEnabled", value, setSavingLineItem, "Line item wise entry")}
        />
        <PreferenceRow
          icon={<Zap size={18} strokeWidth={2} />}
          title="Auto-Post"
          description="Automatically post invoices to QuickBooks once they're scanned with high confidence. Turn this off to always review invoices yourself before posting, no matter how confident the scan is."
          checked={autoPostEnabled}
          saving={savingAutoPost}
          disabled={!canManage}
          onToggle={(value) => handleToggle("autoPostEnabled", value, setSavingAutoPost, "Auto-Post")}
        />
        <PreferenceRow
          icon={<Paperclip size={18} strokeWidth={2} />}
          title="Attach Invoice Copy"
          description="Attach a copy of the scanned invoice file to the QuickBooks bill. Turn this off to post the bill without the original file attached."
          checked={attachInvoiceCopyEnabled}
          saving={savingAttachInvoiceCopy}
          disabled={!canManage}
          onToggle={(value) =>
            handleToggle("attachInvoiceCopyEnabled", value, setSavingAttachInvoiceCopy, "Attach invoice copy")
          }
        />
      </div>
    </div>
  );
}
