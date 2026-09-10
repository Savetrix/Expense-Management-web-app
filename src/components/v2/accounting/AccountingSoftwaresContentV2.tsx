"use client";

import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  Plug,
  Receipt,
  RefreshCw,
  Settings2,
  UserRound,
} from "lucide-react";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { BrandIcon, type BrandName } from "@/components/icons/BrandIcon";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { Modal, ModalDefinitionRow, PageHeader, SearchInput } from "@/components/v2/ui";
import { EmailForwardingPanelV2 } from "@/components/v2/accounting/EmailForwardingPanelV2";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { capitalizeWords } from "@/lib/textFormat";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { connectGoogleDrive, getGoogleDriveStatus, disconnectGoogleDrive } from "@/store/googleDrive/googleDriveApi";
import {
  getDriveConnectedAt as getStoredDriveConnectedAt,
  setDriveConnectedAt as setStoredDriveConnectedAt,
  clearDriveConnectedAt as clearStoredDriveConnectedAt,
} from "@/lib/storage";
import {
  syncQuickBooksAccounts,
  syncQuickBooksTaxCodes,
  syncQuickBooksVendors,
  updateQuickBooksSettings,
} from "@/store/quickBooks/quickBooksApi";
import { useQuickBooksConnections, QBConnection } from "@/store/quickBooks/useQuickBooksConnections";

// The connection/Drive/MCP detail lives in ONE modal slot — only one can be
// open at a time, so swapping which one is open never needs its own show/hide
// wiring. (The v1 screen used a sliding right-hand panel for the same state;
// v2 promotes it to a centered modal, which is what the redesign specifies.)
type DetailView = { type: "connection"; id: string } | { type: "drive" } | { type: "mcp" } | null;

/** Google Drive's own web UI — where "Open Drive" goes. The backend stores no
 *  per-connection folder URL (see checkDriveStatus below), so this is the most
 *  specific destination that actually exists. */
const GOOGLE_DRIVE_URL = "https://drive.google.com";

const COMING_SOON: { key: string; brand: BrandName | null; name: string; description: string }[] = [
  {
    key: "sage",
    brand: "sage",
    name: "Sage",
    description: "Sync Sage Business Cloud Accounting invoices and GL codes with Scantrix.",
  },
  {
    key: "xero",
    brand: "xero",
    name: "Xero",
    description: "Automate invoice posting and multi-currency reconciliation with Xero.",
  },
  {
    // Tally and FreshBooks have no legitimately-licensed brand mark in
    // simple-icons — never hand-approximate a trademarked logo, so this one
    // renders a generic glyph. See BrandIcon.tsx.
    key: "freshbooks",
    brand: null,
    name: "FreshBooks",
    description: "Direct invoice intake, bill payment tracking, and automated tax code matching.",
  },
  {
    key: "zoho",
    brand: "zoho",
    name: "Zoho Books",
    description: "Automate invoice posting and reconciliation with Zoho Books.",
  },
];

const MCP_EXAMPLES = [
  "What invoices are pending review?",
  "Show me this month's vendor totals.",
  "Which invoices failed to post to QuickBooks?",
];

// Carries no display utility on purpose — every call site pairs it with
// `hidden sm:flex`, and a stray `flex` in here would collide with that.
const ROW_ACTION_CLASS =
  "h-8 shrink-0 cursor-pointer items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60";
const MODAL_GHOST_BUTTON_CLASS =
  "flex h-10 w-full cursor-pointer items-center justify-center gap-[var(--space-xs)] rounded-md border border-border bg-surface text-body-sm font-semibold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60";
const MODAL_DANGER_BUTTON_CLASS =
  "h-10 w-full cursor-pointer rounded-md border border-status-danger-border bg-status-danger-bg text-body-sm font-semibold text-status-danger-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

function formatConnectedDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatSyncedAt(value: number | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface SectionHeadingProps {
  label: string;
  count?: number;
  meta?: ReactNode;
}

function SectionHeading({ label, count, meta }: SectionHeadingProps) {
  return (
    <div className="mb-[var(--space-sm)] flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
      <div className="flex items-center gap-[var(--space-sm)]">
        <p className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">{label}</p>
        {typeof count === "number" && (
          <span className="rounded-pill bg-accent-bg px-[var(--space-sm)] text-tiny font-bold leading-5 text-accent-text-on-bg">
            {count}
          </span>
        )}
      </div>
      {meta && <p className="text-tiny text-content-muted">{meta}</p>}
    </div>
  );
}

interface IntegrationRowProps {
  icon: ReactNode;
  name: string;
  description: string;
  /** Right-aligned controls (toggle, Sync now, Connect, Coming Soon pill). */
  actions?: ReactNode;
  /** Opens this integration's detail modal — rendered as a trailing icon
   *  button rather than making the whole row a button, since the row's own
   *  actions are buttons too (no nesting). */
  onOpen?: () => void;
  openLabel?: string;
  selected?: boolean;
  muted?: boolean;
}

function IntegrationRow({
  icon,
  name,
  description,
  actions,
  onOpen,
  openLabel = "Open details",
  selected,
  muted,
}: IntegrationRowProps) {
  const handleRowClick = (e: React.MouseEvent) => {
    if (onOpen && !muted) {
      // Prevent opening if clicking on an action button
      const target = e.target as HTMLElement;
      const isActionClick = target.closest(".integration-row-action");
      if (!isActionClick) {
        onOpen();
      }
    }
  };

  return (
    <div
      onClick={handleRowClick}
      className={`flex items-center gap-[var(--space-md)] rounded-md border bg-surface px-[var(--space-md)] py-[var(--space-sm)] transition-colors ${
        selected ? "border-accent ring-1 ring-accent/30" : "border-border"
      } ${onOpen && !muted ? "cursor-pointer hover:bg-surface-alt" : ""} ${muted ? "opacity-60" : ""}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-semibold text-content-primary">{name}</p>
        <p className="truncate text-caption text-content-secondary">{description}</p>
      </div>
      {actions && <div className="integration-row-action flex shrink-0 items-center gap-[var(--space-sm)]">{actions}</div>}
      {onOpen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={openLabel}
          title={openLabel}
          className="integration-row-action flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-content-secondary hover:bg-surface-alt hover:text-content-primary"
        >
          <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
        </button>
      )}
    </div>
  );
}

function StatusDot({ tone }: { tone: "success" | "warning" | "muted" }) {
  const toneClass =
    tone === "success" ? "bg-status-success-text" : tone === "warning" ? "bg-status-warning-text" : "bg-content-muted";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${toneClass}`} />;
}

interface McpStepProps {
  number: number;
  title: string;
  children: ReactNode;
}

function McpStep({ number, title, children }: McpStepProps) {
  return (
    <div className="flex gap-[var(--space-sm)]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-bg text-caption font-bold text-accent-text-on-bg">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-semibold text-content-primary">{title}</p>
        <div className="mt-[var(--space-xs)]">{children}</div>
      </div>
    </div>
  );
}

export function AccountingSoftwaresContentV2() {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  // Server-side per-connection setting, loaded by getQuickBooksStatus for
  // whichever connection is active — see quickBooksSlice.
  const autoPostEnabled = useAppSelector((state) => state.quickBooks.autoPostEnabled);

  const [driveConnected, setDriveConnected] = useState(false);
  const [driveStatusLoading, setDriveStatusLoading] = useState(true);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveDisconnecting, setDriveDisconnecting] = useState(false);
  // Client-side only — see the storage.ts comment on setDriveConnectedAt.
  const [driveConnectedAt, setDriveConnectedAt] = useState<string | null>(null);

  const [detail, setDetail] = useState<DetailView>(null);
  const [disconnectedExpanded, setDisconnectedExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  // No server-side "last synced" field exists, so this only ever reports a
  // sync this session actually performed — never a fabricated timestamp.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [savingAutoPost, setSavingAutoPost] = useState(false);
  const [realmCopied, setRealmCopied] = useState(false);

  // Falls back to the live production server — see .env.local.example.
  const mcpServerUrl = process.env.NEXT_PUBLIC_MCP_SERVER_URL || "https://mcp.scantrix.ai/mcp";

  const {
    connections,
    activeConnections,
    disconnectedConnections,
    checkingStatus,
    connecting,
    disconnectingId,
    reconnectingId,
    activeConnectionId,
    checkStatus,
    handleConnect,
    handleSwitch,
    handleReconnect,
    handleDisconnect,
  } = useQuickBooksConnections("/v2/accounting-software");

  const selectedConnection: QBConnection | null =
    detail?.type === "connection" ? connections.find((c) => c._id === detail.id) || null : null;
  const isSelectedDisconnected = selectedConnection?.status === "disconnected";
  const isSelectedReconnectRequired = selectedConnection?.status === "reconnect_required";
  const isSelectedActive = Boolean(selectedConnection) && selectedConnection?._id === activeConnectionId;

  const closeDetail = () => {
    setDetail(null);
    setRealmCopied(false);
  };

  const checkDriveStatus = useCallback(async () => {
    setDriveStatusLoading(true);
    const result = await dispatch(getGoogleDriveStatus());
    if (getGoogleDriveStatus.fulfilled.match(result)) {
      // The backend only ever returns {connected} here (see AccountingSoftwaresScreen.tsx's
      // matching comment on the mobile side) — no email/connectedAt/folderUrl exist server-side,
      // so "Connected on" is stamped client-side the first time a connection is observed.
      const data = result.payload?.data;
      const nowConnected = Boolean(data?.connected);
      setDriveConnected(nowConnected);
      if (nowConnected) {
        const stored = getStoredDriveConnectedAt();
        const stampedAt = stored ?? new Date().toISOString();
        if (!stored) setStoredDriveConnectedAt(stampedAt);
        setDriveConnectedAt(stampedAt);
      } else {
        clearStoredDriveConnectedAt();
        setDriveConnectedAt(null);
      }
    }
    setDriveStatusLoading(false);
  }, [dispatch]);

  useEffect(() => {
    checkDriveStatus();
    // Re-check on focus: covers returning from the Google OAuth redirect (the
    // /v2/google-drive landing page bounces back here) and a disconnect done in
    // another tab.
    const onFocus = () => checkDriveStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkDriveStatus]);

  const handleDriveDisconnect = async () => {
    const confirmed = await confirmDialog({
      title: "Disconnect Google Drive?",
      message: "Scantrix will stop saving copies of posted invoices to your Drive. This cannot be undone.",
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!confirmed) return;
    setDriveDisconnecting(true);
    try {
      const result = await dispatch(disconnectGoogleDrive());
      if (disconnectGoogleDrive.fulfilled.match(result)) {
        setDriveConnected(false);
        clearStoredDriveConnectedAt();
        setDriveConnectedAt(null);
        closeDetail();
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not disconnect. Please try again.", "error");
      }
    } finally {
      setDriveDisconnecting(false);
    }
  };

  // Also used as "Reconnect" for an already-connected account — Drive has no
  // per-connection id like QuickBooks does (it's 1:1 with the current QB
  // workspace), so re-running the same OAuth flow (server always forces
  // prompt=consent) is what refreshes/re-authorizes it.
  const handleDriveConnect = async () => {
    setDriveConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/`;
      const result = await dispatch(connectGoogleDrive({ redirectUri }));
      if (connectGoogleDrive.fulfilled.match(result)) {
        const url = result.payload?.data?.url;
        if (url) {
          window.location.href = url;
          return;
        }
        showToast("Could not start Google Drive connection. Please try again.", "error");
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(
          payload?.message === "X-QB-Id header is required"
            ? "Connect a QuickBooks company first — Google Drive is linked to your QuickBooks workspace."
            : payload?.message || "Could not start Google Drive connection. Please try again.",
          "error",
        );
      }
    } finally {
      setDriveConnecting(false);
    }
  };

  const handleCopyMcpUrl = async () => {
    if (!mcpServerUrl || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(mcpServerUrl);
    showToast("Server URL copied.", "success");
  };

  const handleCopyRealmId = async (realmId: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(realmId);
      setRealmCopied(true);
      setTimeout(() => setRealmCopied(false), 2000);
    } catch {
      showToast("Couldn't copy. Select the Realm ID and copy it manually.", "error");
    }
  };

  const handleDisconnectSelected = async () => {
    if (!selectedConnection) return;
    const success = await handleDisconnect(selectedConnection);
    if (success) closeDetail();
  };

  // Pulls the reference data Scantrix reads from QuickBooks (vendors, GL
  // accounts, tax codes) for the ACTIVE connection, then re-checks connection
  // status. All three thunks read qbConnectionId off the store rather than
  // taking it as an argument, which is why this only runs for the active
  // company — a non-active row offers "Switch to this account" instead.
  const handleSyncActive = useCallback(async () => {
    // No activeConnectionId means no X-QB-Id header goes out and the backend
    // rejects all three calls — the top-bar switcher stays blank until a user
    // picks a company when several are connected, so this really can be unset.
    if (!accessToken || !activeConnectionId || syncing) return;
    setSyncing(true);
    try {
      const results = await Promise.all([
        dispatch(syncQuickBooksVendors({ accessToken })),
        dispatch(syncQuickBooksAccounts({ accessToken })),
        dispatch(syncQuickBooksTaxCodes({ accessToken })),
      ]);
      const failed = results.filter((result) => result.meta.requestStatus !== "fulfilled");
      if (failed.length === 0) {
        setLastSyncedAt(Date.now());
        showToast("Vendors, GL accounts and tax codes are up to date.", "success");
      } else {
        showToast(`${failed.length} of 3 syncs failed. Please try again.`, "error");
      }
      await checkStatus();
    } finally {
      setSyncing(false);
    }
  }, [accessToken, activeConnectionId, checkStatus, dispatch, syncing]);

  const handleSyncAll = useCallback(async () => {
    await handleSyncActive();
    await checkDriveStatus();
  }, [checkDriveStatus, handleSyncActive]);

  const handleToggleAutoPost = async (value: boolean) => {
    if (!accessToken || savingAutoPost) return;
    setSavingAutoPost(true);
    try {
      const result = await dispatch(updateQuickBooksSettings({ accessToken, autoPostEnabled: value }));
      if (updateQuickBooksSettings.fulfilled.match(result)) {
        showToast(value ? "Auto-post is on." : "Auto-post is off.", "success");
      } else {
        showToast(typeof result.payload === "string" ? result.payload : "Couldn't update auto-post.", "error");
      }
    } finally {
      setSavingAutoPost(false);
    }
  };

  const driveConnectActionLabel = driveConnecting ? "Connecting…" : driveStatusLoading ? "Checking…" : "Connect";
  const qbConnectActionLabel = connecting
    ? "Connecting…"
    : checkingStatus
      ? "Checking…"
      : activeConnections.length > 0
        ? "Add account"
        : "Connect";

  // Client-side filter over every section — the "Filter connectors" field
  // narrows Connected / Available / Coming soon at once.
  const matches = useCallback(
    (...fields: string[]) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return fields.some((field) => field.toLowerCase().includes(needle));
    },
    [query],
  );

  const visibleActiveConnections = useMemo(
    () => activeConnections.filter((connection) => matches(connection.name, "QuickBooks Online", connection.realmId)),
    [activeConnections, matches],
  );
  const visibleDisconnectedConnections = useMemo(
    () => disconnectedConnections.filter((connection) => matches(connection.name, "QuickBooks Online")),
    [disconnectedConnections, matches],
  );
  const visibleComingSoon = useMemo(
    () => COMING_SOON.filter((item) => matches(item.name, item.description)),
    [matches],
  );

  const driveVisible = driveConnected && matches("Google Drive", "Posted invoices are copied to your Drive");
  const showQbAvailable = matches("QuickBooks", "QuickBooks Online", "Sync vendors and post invoices");
  const showDriveAvailable = !driveConnected && matches("Google Drive", "Save a copy of every posted invoice");
  const showMcpAvailable = matches("Claude MCP", "Ask Claude about your invoices and vendors");

  const connectedCount = activeConnections.length + (driveConnected ? 1 : 0);
  const showConnectedSection =
    checkingStatus ||
    visibleActiveConnections.length > 0 ||
    driveVisible ||
    visibleDisconnectedConnections.length > 0;
  const showAvailableSection = showQbAvailable || showDriveAvailable || showMcpAvailable;
  const nothingMatchesFilter =
    query.trim().length > 0 && !showConnectedSection && !showAvailableSection && visibleComingSoon.length === 0;

  const linkedCompanyName = activeConnections.find((c) => c._id === activeConnectionId)?.name || "—";

  return (
    <div className="w-full p-[var(--space-lg)] sm:p-[var(--space-lg)]">
      <p className="mb-[var(--space-xs)] flex items-center gap-[var(--space-xs)] text-tiny font-bold uppercase tracking-[0.08em] text-accent-text-on-bg">
        Accounting Software
        <ChevronRight size={11} strokeWidth={2.5} className="text-content-muted" />
        Connections
      </p>

      <PageHeader
        title="Integrations"
        subtitle="Connect and synchronize the accounting software, storage drives, and AI tools you use with Scantrix."
        action={
          <>
            {/* <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter connectors"
              aria-label="Filter connectors"
              widthClassName="lg:w-56"
            /> */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSyncAll}
              loading={syncing}
              disabled={!accessToken || !activeConnectionId}
              title={
                activeConnections.length === 0
                  ? "Connect a QuickBooks company first"
                  : !activeConnectionId
                    ? "Pick a company in the top bar first"
                    : "Pull the latest vendors, GL accounts and tax codes for the active company"
              }
            >
              {!syncing && <RefreshCw size={14} strokeWidth={2.25} />}
              Sync all connectors
            </Button>
          </>
        }
      />

      <div className="mt-[var(--space-lg)] flex flex-col gap-[var(--space-lg)]">
        {showConnectedSection && (
          <section>
            <SectionHeading
              label="Connected"
              count={checkingStatus ? undefined : connectedCount}
              meta={lastSyncedAt ? `Last synced ${formatSyncedAt(lastSyncedAt)}` : undefined}
            />
            <div className="flex flex-col gap-[var(--space-sm)]">
              {checkingStatus ? (
                <SkeletonListRows count={2} />
              ) : (
                visibleActiveConnections.map((connection) => {
                  const isActive = connection._id === activeConnectionId;
                  const needsReconnect = connection.status === "reconnect_required";
                  const isSelected = detail?.type === "connection" && detail.id === connection._id;
                  return (
                    <IntegrationRow
                      key={connection._id}
                      icon={<BrandIcon name="quickbooks" size={22} />}
                      name={connection.name}
                      description={
                        needsReconnect
                          ? "QuickBooks Online · needs reconnect"
                          : isActive
                            ? "QuickBooks Online · active company"
                            : "QuickBooks Online"
                      }
                      selected={isSelected}
                      onOpen={() => setDetail({ type: "connection", id: connection._id })}
                      openLabel={`Manage ${connection.name}`}
                      actions={
                        <>
                          <Badge variant={needsReconnect ? "warning" : isActive ? "success" : "neutral"}>
                            {needsReconnect ? "Reconnect required" : isActive ? "Active" : "Connected"}
                          </Badge>
                          {isActive && (
                            <button
                              type="button"
                              onClick={handleSyncActive}
                              disabled={syncing || !accessToken}
                              className={`hidden sm:flex ${ROW_ACTION_CLASS}`}
                            >
                              <RefreshCw size={13} strokeWidth={2.25} className={syncing ? "animate-spin" : ""} />
                              {syncing ? "Syncing…" : "Sync now"}
                            </button>
                          ) }
                        </>
                      }
                    />
                  );
                })
              )}

              {driveVisible && (
                <IntegrationRow
                  icon={<BrandIcon name="google-drive" size={22} />}
                  name="Google Drive"
                  description="Posted invoices are copied to your Drive automatically."
                  selected={detail?.type === "drive"}
                  onOpen={() => setDetail({ type: "drive" })}
                  openLabel="Manage Google Drive"
                  actions={
                    <>
                      <Badge variant="success">Connected</Badge>
                      <a
                        href={GOOGLE_DRIVE_URL}
                        target="_blank"
                        rel="noreferrer"
                        className={`hidden sm:flex ${ROW_ACTION_CLASS}`}
                      >
                        <FolderOpen size={13} strokeWidth={2.25} />
                        Open Drive
                      </a>
                    </>
                  }
                />
              )}
            </div>

            {visibleDisconnectedConnections.length > 0 && (
              <div className="mt-[var(--space-sm)] overflow-hidden rounded-md border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => setDisconnectedExpanded((v) => !v)}
                  aria-expanded={disconnectedExpanded}
                  className="flex w-full cursor-pointer items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-left hover:bg-surface-alt"
                >
                  <div className="min-w-0">
                    <p className="text-body-sm font-semibold text-content-primary">Disconnected accounts</p>
                    <p className="truncate text-caption text-content-secondary">
                      {visibleDisconnectedConnections.length} previously connected
                    </p>
                  </div>
                  <ChevronDown
                    size={16}
                    strokeWidth={2}
                    className={`shrink-0 text-content-secondary transition-transform ${disconnectedExpanded ? "rotate-180" : ""}`}
                  />
                </button>

                {disconnectedExpanded && (
                  <ul className="flex flex-col border-t border-border">
                    {visibleDisconnectedConnections.map((connection) => {
                      const isSelected = detail?.type === "connection" && detail.id === connection._id;
                      return (
                        <li key={connection._id}>
                          <button
                            type="button"
                            onClick={() => setDetail({ type: "connection", id: connection._id })}
                            className={`flex w-full cursor-pointer items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)] text-left ${
                              isSelected ? "bg-accent-bg" : "hover:bg-surface-alt"
                            }`}
                          >
                            <StatusDot tone="muted" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-caption font-semibold text-content-primary">
                                {connection.name}
                              </span>
                              <span className="block text-tiny text-content-muted">Disconnected</span>
                            </span>
                            <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-content-muted" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}

        {showAvailableSection && (
          <section>
            <SectionHeading label="Available to connect" meta="Connect once, sync continuously" />
            <div className="flex flex-col gap-[var(--space-sm)]">
              {showQbAvailable && (
                <IntegrationRow
                  icon={<BrandIcon name="quickbooks" size={22} />}
                  name="QuickBooks"
                  description={
                    activeConnections.length > 0
                      ? "Connect another QuickBooks company to Scantrix."
                      : "Sync vendors and post invoices automatically."
                  }
                  actions={
                    <Button type="button" size="sm" onClick={handleConnect} loading={connecting} className="shrink-0">
                      {!connecting && <Plug size={14} strokeWidth={2.25} />}
                      {qbConnectActionLabel}
                    </Button>
                  }
                />
              )}
              {showDriveAvailable && (
                <IntegrationRow
                  icon={<BrandIcon name="google-drive" size={22} />}
                  name="Google Drive"
                  description="Save a copy of every posted invoice to your Drive."
                  actions={
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleDriveConnect}
                      loading={driveConnecting}
                      disabled={driveStatusLoading}
                      className="shrink-0"
                    >
                      {!driveConnecting && <Plug size={14} strokeWidth={2.25} />}
                      {driveConnectActionLabel}
                    </Button>
                  }
                />
              )}
              {showMcpAvailable && (
                <IntegrationRow
                  icon={<BrandIcon name="claude" size={22} />}
                  name="Claude MCP"
                  description="Ask Claude about your invoices and vendors from Scantrix."
                  actions={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDetail({ type: "mcp" })}
                      className="shrink-0"
                    >
                      Setup guide
                    </Button>
                  }
                />
              )}
            </div>
          </section>
        )}

        {visibleComingSoon.length > 0 && (
          <section>
            <SectionHeading label="Coming soon" meta="Currently in active development" />
            <div className="flex flex-col gap-[var(--space-sm)]">
              {visibleComingSoon.map((item) => (
                <IntegrationRow
                  key={item.key}
                  muted
                  icon={
                    item.brand ? (
                      <BrandIcon name={item.brand} size={22} />
                    ) : (
                      <Receipt size={20} strokeWidth={1.75} className="text-content-secondary" />
                    )
                  }
                  name={item.name}
                  description={item.description}
                  actions={<Badge variant="neutral">Coming soon</Badge>}
                />
              ))}
            </div>
          </section>
        )}

        {nothingMatchesFilter && (
          <div className="rounded-md border border-border bg-surface">
            <EmptyState
              icon={<Plug size={26} strokeWidth={1.75} />}
              title="No connectors match"
              description={`Nothing here matches “${query.trim()}”. Clear the filter to see every integration.`}
              actionLabel="Clear filter"
              onAction={() => setQuery("")}
            />
          </div>
        )}
      </div>

      {/* ── QuickBooks connection detail ─────────────────────────────────── */}
      <Modal
        open={detail?.type === "connection" && Boolean(selectedConnection)}
        onClose={closeDetail}
        widthClassName="max-w-lg"
        title={
          selectedConnection ? (
            <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
                <BrandIcon name="quickbooks" size={18} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">
                  QuickBooks Online
                </span>
                <span className="truncate text-h3 font-bold text-content-primary">{selectedConnection.name}</span>
              </span>
            </span>
          ) : (
            ""
          )
        }
      >
        {selectedConnection && (
          <>
            <p className="flex items-center gap-[var(--space-xs)] text-caption font-semibold text-content-secondary">
              <StatusDot
                tone={isSelectedDisconnected ? "muted" : isSelectedReconnectRequired ? "warning" : isSelectedActive ? "success" : "muted"}
              />
              {isSelectedDisconnected
                ? "Disconnected"
                : isSelectedReconnectRequired
                  ? "Needs reconnect"
                  : isSelectedActive
                    ? "Active connection"
                    : "Inactive — not the company currently in use"}
            </p>

            <div className="mt-[var(--space-md)] rounded-md border border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-xs)]">
              <ModalDefinitionRow
                label={isSelectedDisconnected ? "Disconnected on" : "Connected on"}
                icon={<CalendarDays size={14} strokeWidth={2} />}
              >
                {formatConnectedDate(isSelectedDisconnected ? selectedConnection.updatedAt : selectedConnection.createdAt)}
              </ModalDefinitionRow>
              <ModalDefinitionRow label="Realm ID" icon={<Code2 size={14} strokeWidth={2} />}>
                <span className="truncate font-mono text-caption">{selectedConnection.realmId}</span>
                <button
                  type="button"
                  onClick={() => handleCopyRealmId(selectedConnection.realmId)}
                  aria-label={realmCopied ? "Realm ID copied" : "Copy Realm ID"}
                  className="flex h-6 shrink-0 cursor-pointer items-center gap-[var(--space-xs)] rounded-sm bg-accent-bg px-[var(--space-xs)] text-tiny font-bold text-accent-text-on-bg hover:opacity-90"
                >
                  {realmCopied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2.5} />}
                  {realmCopied ? "Copied" : "Copy"}
                </button>
              </ModalDefinitionRow>
              <ModalDefinitionRow label="User type" icon={<UserRound size={14} strokeWidth={2} />}>
                <Badge variant="neutral">{capitalizeWords(selectedConnection.role)}</Badge>
              </ModalDefinitionRow>
              <ModalDefinitionRow label="Company" icon={<Building2 size={14} strokeWidth={2} />}>
                <span className="truncate">{selectedConnection.name}</span>
              </ModalDefinitionRow>
            </div>

            {/* Only the active connection: updateQuickBooksSettings and every
                sync thunk send X-QB-Id from state.quickBooks.qbConnectionId,
                so they always target the active company — showing these for
                another row would silently change the wrong company. */}
            {isSelectedActive && !isSelectedDisconnected && (
              <div className="mt-[var(--space-md)] flex items-center justify-between gap-[var(--space-md)] rounded-md border border-border px-[var(--space-md)] py-[var(--space-sm)]">
                <div className="min-w-0">
                  <p className="text-body-sm font-semibold text-content-primary">Auto-post approved invoices</p>
                  <p className="text-caption text-content-secondary">
                    Push reviewed invoices to QuickBooks without a second confirmation.
                  </p>
                </div>
                <Switch
                  checked={autoPostEnabled}
                  onChange={handleToggleAutoPost}
                  disabled={savingAutoPost || !accessToken}
                  label="Auto-post approved invoices"
                />
              </div>
            )}

            <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)]">
              {isSelectedActive && !isSelectedDisconnected && (
                <button
                  type="button"
                  onClick={handleSyncActive}
                  disabled={syncing || !accessToken}
                  className={MODAL_GHOST_BUTTON_CLASS}
                >
                  <RefreshCw size={14} strokeWidth={2.25} className={syncing ? "animate-spin" : ""} />
                  {syncing ? "Syncing…" : "Sync vendors, GL accounts & tax codes"}
                </button>
              )}
              {!isSelectedDisconnected && !isSelectedActive && (
                <button
                  type="button"
                  onClick={() => handleSwitch(selectedConnection)}
                  className={MODAL_GHOST_BUTTON_CLASS}
                >
                  Switch to this account
                </button>
              )}
              {/* Reconnect is offered for every connection in the detail
                  panel, not just owner/admin: reconnecting re-runs OAuth for
                  THIS connection to rotate its tokens, which is how an active
                  account gets refreshed. The backend still enforces whatever
                  role it enforces. */}
              <button
                type="button"
                onClick={() => handleReconnect(selectedConnection)}
                disabled={reconnectingId === selectedConnection._id}
                className={MODAL_GHOST_BUTTON_CLASS}
              >
                {reconnectingId === selectedConnection._id ? "Reconnecting…" : "Reconnect"}
              </button>
              {!isSelectedDisconnected && (
                <button
                  type="button"
                  onClick={handleDisconnectSelected}
                  disabled={disconnectingId === selectedConnection._id}
                  className={MODAL_DANGER_BUTTON_CLASS}
                >
                  {disconnectingId === selectedConnection._id ? "Disconnecting…" : "Disconnect"}
                </button>
              )}
            </div>

            {/* A receiving address belongs to ONE QuickBooks company, so it
                lives in that company's detail view rather than in a global
                settings screen. That placement is also the answer to managing
                several clients: each company has its own address, and the
                address itself decides where an invoice is filed. */}
            <EmailForwardingPanelV2
              qbConnectionId={selectedConnection._id}
              companyName={selectedConnection.name}
              disabled={isSelectedDisconnected || isSelectedReconnectRequired}
            />
          </>
        )}
      </Modal>

      {/* ── Google Drive detail ──────────────────────────────────────────── */}
      <Modal
        open={detail?.type === "drive" && driveConnected}
        onClose={closeDetail}
        widthClassName="max-w-md"
        title={
          <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
              <BrandIcon name="google-drive" size={18} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">Storage</span>
              <span className="truncate text-h3 font-bold text-content-primary">Google Drive</span>
            </span>
          </span>
        }
      >
        <p className="flex items-center gap-[var(--space-xs)] text-caption font-semibold text-content-secondary">
          <StatusDot tone="success" />
          Active connection
        </p>

        <div className="mt-[var(--space-md)] rounded-md border border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-xs)]">
          <ModalDefinitionRow label="Connected on" icon={<CalendarDays size={14} strokeWidth={2} />}>
            {formatConnectedDate(driveConnectedAt)}
          </ModalDefinitionRow>
          <ModalDefinitionRow label="Linked QuickBooks company" icon={<Building2 size={14} strokeWidth={2} />}>
            <span className="truncate">{linkedCompanyName}</span>
          </ModalDefinitionRow>
        </div>

        <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)]">
          <a
            href={GOOGLE_DRIVE_URL}
            target="_blank"
            rel="noreferrer"
            className={MODAL_GHOST_BUTTON_CLASS}
          >
            <ExternalLink size={14} strokeWidth={2.25} />
            Open Google Drive
          </a>
          <button
            type="button"
            onClick={handleDriveConnect}
            disabled={driveConnecting}
            className={MODAL_GHOST_BUTTON_CLASS}
          >
            {driveConnecting ? "Reconnecting…" : "Reconnect"}
          </button>
          <button
            type="button"
            onClick={handleDriveDisconnect}
            disabled={driveDisconnecting}
            className={MODAL_DANGER_BUTTON_CLASS}
          >
            {driveDisconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </Modal>

      {/* ── Claude MCP setup guide ───────────────────────────────────────── */}
      <Modal
        open={detail?.type === "mcp"}
        onClose={closeDetail}
        widthClassName="max-w-lg"
        title={
          <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
              <BrandIcon name="claude" size={18} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">Setup guide</span>
              <span className="truncate text-h3 font-bold text-content-primary">Claude MCP</span>
            </span>
          </span>
        }
      >
        <div className="flex flex-col gap-[var(--space-lg)]">
          <McpStep number={1} title="Copy your server URL">
            <div className="flex items-center gap-[var(--space-sm)]">
              <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-alt px-[var(--space-sm)] py-[var(--space-xs)] font-mono text-caption text-content-secondary">
                {mcpServerUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyMcpUrl}
                className="flex h-8 shrink-0 cursor-pointer items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt"
              >
                <Copy size={12} strokeWidth={2.5} />
                Copy
              </button>
            </div>
          </McpStep>

          <McpStep number={2} title="Add Scantrix as a connector">
            <p className="text-caption text-content-secondary">
              <span className="font-semibold text-content-primary">Claude.ai / Claude Desktop:</span>
            </p>
            <ol className="mt-[var(--space-xs)] flex list-decimal flex-col gap-[var(--space-xs)] pl-[var(--space-md)] text-caption text-content-secondary">
              <li>
                Open <span className="font-semibold text-content-primary">Settings → Customize → Connectors</span>.
              </li>
              <li>
                Click <span className="font-semibold text-content-primary">Add custom connector</span>.
              </li>
              <li>
                For the name, enter <span className="font-semibold text-content-primary">Scantrix</span>.
              </li>
              <li>Paste the URL you copied in Step 1.</li>
              <li>
                Click <span className="font-semibold text-content-primary">Add</span> /{" "}
                <span className="font-semibold text-content-primary">Connect</span>.
              </li>
            </ol>
            <p className="mt-[var(--space-sm)] text-caption text-content-secondary">
              <span className="font-semibold text-content-primary">Claude Code:</span>
            </p>
            <pre className="mt-[var(--space-xs)] overflow-x-auto rounded-md border border-border bg-surface-alt px-[var(--space-sm)] py-[var(--space-xs)] font-mono text-caption text-content-primary">
              claude mcp add --transport http scantrix {mcpServerUrl}
            </pre>
          </McpStep>

          <McpStep number={3} title="Authorize and start asking">
            <p className="text-caption text-content-secondary">
              Sign in with your Scantrix account when prompted, then try:
            </p>
            <ul className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-xs)]">
              {MCP_EXAMPLES.map((example) => (
                <li
                  key={example}
                  className="rounded-md border border-border bg-surface-alt px-[var(--space-sm)] py-[var(--space-xs)] text-caption italic text-content-secondary"
                >
                  “{example}”
                </li>
              ))}
            </ul>
          </McpStep>
        </div>
      </Modal>
    </div>
  );
}
