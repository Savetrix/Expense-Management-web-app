"use client";

import { useCallback, useEffect, useState } from "react";

import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  clearDriveConnectedAt,
  clearOneDriveConnectedAt,
  getDriveConnectedAt,
  getOneDriveConnectedAt,
  setDriveConnectedAt,
  setOneDriveConnectedAt,
} from "@/lib/storage";

import { connectGoogleDrive, disconnectGoogleDrive, getGoogleDriveStatus } from "./googleDrive/googleDriveApi";
import { connectOneDrive, disconnectOneDrive, getOneDriveStatus } from "./oneDrive/oneDriveApi";
import { useAppDispatch } from "./hooks";

export type StorageDriveId = "google-drive" | "onedrive";

// Both storage integrations have the same backend shape (connect → OAuth
// redirect → /{google-drive|onedrive} return page, status → {connected,
// email}, disconnect), are linked per accounting-company workspace, and are
// independent of each other — when both are connected, posted invoices are
// copied to both.
const DRIVES = {
  "google-drive": {
    name: "Google Drive",
    shortName: "Drive",
    status: getGoogleDriveStatus,
    connect: connectGoogleDrive,
    disconnect: disconnectGoogleDrive,
    getConnectedAt: getDriveConnectedAt,
    setConnectedAt: setDriveConnectedAt,
    clearConnectedAt: clearDriveConnectedAt,
  },
  onedrive: {
    name: "OneDrive",
    shortName: "OneDrive",
    status: getOneDriveStatus,
    connect: connectOneDrive,
    disconnect: disconnectOneDrive,
    getConnectedAt: getOneDriveConnectedAt,
    setConnectedAt: setOneDriveConnectedAt,
    clearConnectedAt: clearOneDriveConnectedAt,
  },
} as const;

type RejectedPayload = { message?: string } | undefined;

export function useStorageDrive(id: StorageDriveId, activeConnectionId: string | null | undefined) {
  const dispatch = useAppDispatch();
  const drive = DRIVES[id];

  const [connected, setConnected] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Client-side only — see the storage.ts comment on setDriveConnectedAt.
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    // Linked per accounting workspace (the backend reads the X-QB-Id header),
    // so with no company selected it can only ever answer "not connected" —
    // skip the round trip. Storage is left alone: this isn't a real disconnect.
    if (!activeConnectionId) {
      setConnected(false);
      setEmail(null);
      setStatusLoading(false);
      return;
    }
    setStatusLoading(true);
    const result = await dispatch(drive.status());
    if (result.meta.requestStatus === "fulfilled") {
      // The backend returns {connected, email} — no connectedAt/folderUrl
      // exist server-side, so "Connected on" is still stamped client-side
      // the first time a connection is observed.
      const data = (result.payload as { data?: { connected?: boolean; email?: string | null } })?.data;
      const nowConnected = Boolean(data?.connected);
      setConnected(nowConnected);
      setEmail(nowConnected ? data?.email ?? null : null);
      if (nowConnected) {
        const stored = drive.getConnectedAt();
        const stampedAt = stored ?? new Date().toISOString();
        if (!stored) drive.setConnectedAt(stampedAt);
        setConnectedAt(stampedAt);
      } else {
        drive.clearConnectedAt();
        setConnectedAt(null);
      }
    }
    setStatusLoading(false);
  }, [dispatch, drive, activeConnectionId]);

  // checkStatus changes identity with activeConnectionId, so switching
  // company re-checks — otherwise the previous workspace's state keeps
  // showing. The OAuth return is a full page load (via /google-drive or
  // /onedrive), so mount covers it; tab visibility covers a disconnect in
  // another tab.
  useEffect(() => {
    checkStatus();
    const onVisible = () => {
      if (document.visibilityState === "visible") checkStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkStatus]);

  // Also used as "Reconnect" for an already-connected account — it's 1:1
  // with the current workspace, so re-running the same OAuth flow is what
  // refreshes/re-authorizes it.
  const connect = async () => {
    setConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/`;
      const result = await dispatch(drive.connect({ redirectUri }));
      if (result.meta.requestStatus === "fulfilled") {
        const url = (result.payload as { data?: { url?: string } })?.data?.url;
        if (url) {
          window.location.href = url;
          return;
        }
        showToast(`Could not start ${drive.name} connection. Please try again.`, "error");
      } else {
        const payload = result.payload as RejectedPayload;
        showToast(
          payload?.message === "X-QB-Id header is required"
            ? `Connect an accounting company first — ${drive.name} is linked to that company's workspace.`
            : payload?.message || `Could not start ${drive.name} connection. Please try again.`,
          "error",
        );
      }
    } finally {
      setConnecting(false);
    }
  };

  // Resolves true once actually disconnected (false if cancelled/failed).
  const disconnect = async (): Promise<boolean> => {
    const confirmed = await confirmDialog({
      title: `Disconnect ${drive.name}?`,
      message: `Scantrix will stop saving copies of posted invoices to your ${drive.shortName}. This cannot be undone.`,
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!confirmed) return false;
    setDisconnecting(true);
    try {
      const result = await dispatch(drive.disconnect());
      if (result.meta.requestStatus === "fulfilled") {
        setConnected(false);
        drive.clearConnectedAt();
        setConnectedAt(null);
        return true;
      }
      const payload = result.payload as RejectedPayload;
      showToast(payload?.message || "Could not disconnect. Please try again.", "error");
      return false;
    } finally {
      setDisconnecting(false);
    }
  };

  return {
    id,
    name: drive.name,
    shortName: drive.shortName,
    connected,
    email,
    connectedAt,
    statusLoading,
    connecting,
    disconnecting,
    checkStatus,
    connect,
    disconnect,
  };
}

export type StorageDrive = ReturnType<typeof useStorageDrive>;
