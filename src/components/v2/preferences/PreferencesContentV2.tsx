"use client";

import { Paperclip, Rows3, SlidersHorizontal, Zap } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { PageHeader, RoleInfoBanner } from "@/components/v2/ui";
import { PreferenceRow } from "./PreferenceRow";
import { usePreferencesSettings } from "./usePreferencesSettings";

export function PreferencesContentV2() {
  const {
    activeConnections,
    checkingStatus,
    connecting,
    handleConnect,
    activeConnection,
    currentRole,
    canManage,
    autoPostEnabled,
    lineItemWiseEnabled,
    attachInvoiceCopyEnabled,
    savingAutoPost,
    savingLineItem,
    savingAttachInvoiceCopy,
    toggleLineItemWise,
    toggleAutoPost,
    toggleAttachInvoiceCopy,
  } = usePreferencesSettings();

  if (checkingStatus) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="w-full max-w-2xl p-[var(--space-md)] sm:p-[var(--space-lg)]">
        <div className="rounded-lg border border-border bg-surface shadow-sm">
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
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader title="Preferences" subtitle={`Control how invoices post to QuickBooks for ${activeConnection.name}.`} />

      {!canManage && (
        <div className="mt-[var(--space-md)]">
          <RoleInfoBanner>
            You have {currentRole || "limited"} access on {activeConnection.name} and can view these preferences but not
            change them. Ask an owner or admin to update them.
          </RoleInfoBanner>
        </div>
      )}

      <div className="mt-[var(--space-lg)] divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <PreferenceRow
          icon={<Rows3 size={18} strokeWidth={2} />}
          title="Line item wise Entry"
          description="Book every extracted invoice line item as its own line in the QuickBooks entry. When off, each invoice posts as a single consolidated line."
          checked={lineItemWiseEnabled}
          saving={savingLineItem}
          disabled={!canManage}
          onToggle={toggleLineItemWise}
        />
        <PreferenceRow
          icon={<Zap size={18} strokeWidth={2} />}
          title="Auto-Post"
          description="Automatically post invoices to QuickBooks once they're scanned with high confidence. Turn this off to always review invoices yourself before posting, no matter how confident the scan is."
          checked={autoPostEnabled}
          saving={savingAutoPost}
          disabled={!canManage}
          onToggle={toggleAutoPost}
        />
        <PreferenceRow
          icon={<Paperclip size={18} strokeWidth={2} />}
          title="Attach Invoice Copy"
          description="Attach a copy of the scanned invoice file to the QuickBooks bill. Turn this off to post the bill without the original file attached."
          checked={attachInvoiceCopyEnabled}
          saving={savingAttachInvoiceCopy}
          disabled={!canManage}
          onToggle={toggleAttachInvoiceCopy}
        />
      </div>
    </div>
  );
}
