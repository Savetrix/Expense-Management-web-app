"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  connectQuickBooks,
  disconnectQuickBooks,
  getMyQBConnections,
  getQuickBooksStatus,
} from "@/store/quickBooks/quickBooksApi";

export interface QBConnection {
  _id: string;
  name: string;
  realmId: string;
  role: string;
  createdAt: string;
  updatedAt?: string;
  /**
   * Backend derives this from isDeleted/needsReconnect — absent on older cached
   * data, treat as active. "reconnect_required" means Intuit revoked/expired
   * the refresh token; the connection still exists but needs the user to
   * re-authorize before it'll work again.
   */
  status?: "active" | "disconnected" | "reconnect_required";
}

// Shared between QuickBooksConnectContent (the dedicated /quickbooks page)
// and AccountingSoftwaresContent (the Integrations hub's connected-accounts
// drill-down) so both surfaces manage the same connection list/actions from
// one place instead of two copies drifting apart.
export function useQuickBooksConnections(redirectPath: string) {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const activeConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);

  const [connections, setConnections] = useState<QBConnection[]>([]);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!accessToken) {
      setCheckingStatus(false);
      return;
    }
    setCheckingStatus(true);
    const result = await dispatch(getMyQBConnections({ accessToken }));
    if (getMyQBConnections.fulfilled.match(result)) {
      const list: QBConnection[] = result.payload?.data?.connections ?? [];
      setConnections(list);
      // Skip disconnected entries — the backend now returns them alongside
      // active ones, and status-checking a disconnected connection 404s.
      const active = list.filter((c) => c.status !== "disconnected");
      // With exactly one choice there's nothing to pick, so check its status
      // directly. With 2+, only refresh status for whichever one is already
      // selected — never silently default to "the first one" here, that
      // would undo the top-bar switcher's blank-until-chosen behavior.
      const target = active.length === 1 ? active[0] : active.find((c) => c._id === activeConnectionId);
      if (target?._id) {
        await dispatch(getQuickBooksStatus({ accessToken, qbConnectionId: target._id }));
      }
    }
    setCheckingStatus(false);
  }, [accessToken, dispatch, activeConnectionId]);

  useEffect(() => {
    checkStatus();
    // Re-check whenever the tab regains focus: covers returning from the
    // QuickBooks OAuth redirect (completed in this same tab) and a
    // disconnect/reconnect done in another tab.
    const onFocus = () => checkStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkStatus]);

  const handleSwitch = async (connection: QBConnection) => {
    if (connection._id === activeConnectionId || !accessToken) return;
    const confirmed = await confirmDialog({
      title: "Switch active account?",
      message: `Switch active account to ${connection.name}?`,
      confirmLabel: "Switch",
    });
    if (!confirmed) return;
    await dispatch(getQuickBooksStatus({ accessToken, qbConnectionId: connection._id }));
  };

  const handleConnect = async () => {
    if (!accessToken || connecting) return;
    setConnecting(true);
    try {
      const redirectAfter = `${window.location.origin}${redirectPath}`;
      const result = await dispatch(connectQuickBooks({ accessToken, redirectAfter }));
      if (connectQuickBooks.fulfilled.match(result)) {
        const authUrl = result.payload?.data?.authUrl;
        if (authUrl) {
          window.location.href = authUrl;
          return;
        }
        showToast("Could not start QuickBooks connection. Please try again.", "error");
      } else {
        showToast(typeof result.payload === "string" ? result.payload : "Could not start QuickBooks connection.", "error");
      }
    } finally {
      setConnecting(false);
    }
  };

  // Re-authorizes the SAME connection (refreshes its tokens) — the fix for a
  // malformed/expired token that's currently blocking both disconnect and
  // scanning on that connection. Owner/admin only, mirrored from the backend
  // check in connectQuickBooks (?qbConnectionId=... path).
  const handleReconnect = async (connection: QBConnection) => {
    if (!accessToken || reconnectingId) return;
    setReconnectingId(connection._id);
    try {
      const redirectAfter = `${window.location.origin}${redirectPath}`;
      const result = await dispatch(connectQuickBooks({ accessToken, redirectAfter, qbConnectionId: connection._id }));
      if (connectQuickBooks.fulfilled.match(result)) {
        const authUrl = result.payload?.data?.authUrl;
        if (authUrl) {
          window.location.href = authUrl;
          return;
        }
        showToast("Could not start reconnect. Please try again.", "error");
      } else {
        showToast(typeof result.payload === "string" ? result.payload : "Could not start reconnect.", "error");
      }
    } finally {
      setReconnectingId(null);
    }
  };

  // Returns whether the disconnect actually went through — callers that show
  // a detail panel for the connection being disconnected use this to close
  // that panel afterward. The dialog also offers "Reconnect instead": for a
  // live account, disconnect + reconnect is how you force a fresh OAuth
  // authorization and rotate the tokens, so the destructive path always
  // has a non-destructive refresh option right next to it.
  const handleDisconnect = async (connection: QBConnection): Promise<boolean> => {
    if (!accessToken) return false;
    const choice = await confirmDialog({
      title: "Disconnect QuickBooks account?",
      message: `Disconnect "${connection.name}"? This cannot be undone.\n\nReconnect instead to refresh the connection without removing it.`,
      confirmLabel: "Disconnect",
      altLabel: "Reconnect instead",
      tone: "destructive",
    });
    if (choice === "alt") {
      await handleReconnect(connection);
      return false;
    }
    if (choice !== true) return false;
    setDisconnectingId(connection._id);
    try {
      const result = await dispatch(disconnectQuickBooks({ accessToken, qbConnectionId: connection._id }));
      if (disconnectQuickBooks.fulfilled.match(result)) {
        setConnections((prev) => prev.filter((c) => c._id !== connection._id));
        await checkStatus();
        return true;
      }
      showToast(typeof result.payload === "string" ? result.payload : "Unable to disconnect.", "error");
      return false;
    } finally {
      setDisconnectingId(null);
    }
  };

  const activeConnections = useMemo(
    () => connections.filter((c) => c.status !== "disconnected"),
    [connections],
  );
  const disconnectedConnections = useMemo(
    () => connections.filter((c) => c.status === "disconnected"),
    [connections],
  );

  return {
    connections,
    activeConnections,
    disconnectedConnections,
    checkingStatus,
    connecting,
    disconnectingId,
    reconnectingId,
    activeConnectionId,
    checkStatus,
    handleSwitch,
    handleConnect,
    handleReconnect,
    handleDisconnect,
  };
}
