"use client";

import { Paperclip, Rows3, SlidersHorizontal, Zap } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { Modal, RoleInfoBanner } from "@/components/v2/ui";
import { PreferenceRow } from "./PreferenceRow";
import { usePreferencesSettings } from "./usePreferencesSettings";

// In-place counterpart of PreferencesContentV2 (the /v2/preferences route) —
// same usePreferencesSettings hook, rendered inside the shared Modal shell
// instead of navigating away. Mirrors VendorResolutionDialogV2's
// relationship to VendorResolutionContentV2.
export function PreferencesDialogV2({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  return (
    <Modal open={open} onClose={onClose} title="Preferences" widthClassName="max-w-2xl">
      {checkingStatus ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : !activeConnection ? (
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
      ) : (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-secondary">
            Control how invoices post to QuickBooks for {activeConnection.name}.
          </p>

          {!canManage && (
            <RoleInfoBanner>
              You have {currentRole || "limited"} access on {activeConnection.name} and can view these preferences but not
              change them. Ask an owner or admin to update them.
            </RoleInfoBanner>
          )}

          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
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
      )}
    </Modal>
  );
}
