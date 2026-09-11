"use client";

import { useState } from "react";

import { showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateQuickBooksSettings } from "@/store/quickBooks/quickBooksApi";
import { useQuickBooksConnections } from "@/store/quickBooks/useQuickBooksConnections";

// Shared by PreferencesContentV2 (the /v2/preferences route) and
// PreferencesDialogV2 (opened in place from ProfileContentV2) — same store
// reads, connection resolution, and QuickBooks settings thunk either way.
export function usePreferencesSettings() {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const autoPostEnabled = useAppSelector((state) => state.quickBooks.autoPostEnabled);
  const lineItemWiseEnabled = useAppSelector((state) => state.quickBooks.lineItemWiseEnabled);
  const attachInvoiceCopyEnabled = useAppSelector((state) => state.quickBooks.attachInvoiceCopyEnabled);

  const [savingAutoPost, setSavingAutoPost] = useState(false);
  const [savingLineItem, setSavingLineItem] = useState(false);
  const [savingAttachInvoiceCopy, setSavingAttachInvoiceCopy] = useState(false);

  const { activeConnections, activeConnectionId, checkingStatus, connecting, handleConnect } =
    useQuickBooksConnections("/v2/preferences");

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

  return {
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
    toggleLineItemWise: (value: boolean) => handleToggle("lineItemWiseEnabled", value, setSavingLineItem, "Line item wise entry"),
    toggleAutoPost: (value: boolean) => handleToggle("autoPostEnabled", value, setSavingAutoPost, "Auto-Post"),
    toggleAttachInvoiceCopy: (value: boolean) =>
      handleToggle("attachInvoiceCopyEnabled", value, setSavingAttachInvoiceCopy, "Attach invoice copy"),
  };
}
