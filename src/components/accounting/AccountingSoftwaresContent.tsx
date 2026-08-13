"use client";

import { ChevronDown, ChevronRight, Receipt, X } from "lucide-react";
import { ReactNode, useCallback, useEffect, useState } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { capitalizeWords } from "@/lib/textFormat";
import { useAppDispatch } from "@/store/hooks";
import { connectGoogleDrive, getGoogleDriveStatus, disconnectGoogleDrive } from "@/store/googleDrive/googleDriveApi";
import {
  getDriveConnectedAt as getStoredDriveConnectedAt,
  setDriveConnectedAt as setStoredDriveConnectedAt,
  clearDriveConnectedAt as clearStoredDriveConnectedAt,
} from "@/lib/storage";
import { useQuickBooksConnections, QBConnection } from "@/store/quickBooks/useQuickBooksConnections";

// The right-hand detail panel is a single slot shared by every "open a
// detail view" row below — only one can be visible at a time, and swapping
// which one is open never needs its own show/hide wiring.
type DetailView = { type: "connection"; id: string } | { type: "drive" } | { type: "mcp" } | null;

function ComingSoonCard({ icon, name, description }: { icon: ReactNode; name: string; description: string }) {
  return (
    <div className="rounded-lg bg-white p-[var(--space-md)] opacity-60 shadow-sm">
      <div className="flex items-center gap-[var(--space-md)]">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-background-alt">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-text-primary">{name}</p>
          <p className="truncate text-caption text-text-secondary">{description}</p>
        </div>
        <span className="hidden shrink-0 rounded-pill bg-background-alt px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-text-secondary sm:block">
          Coming Soon
        </span>
      </div>
    </div>
  );
}

// A connected account (QuickBooks company, Google Drive) — always clickable,
// opens its detail in the shared right-hand panel.
function ConnectedRow({
  icon,
  name,
  description,
  badgeLabel,
  badgeClassName,
  tag,
  selected,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  description: string;
  badgeLabel: string;
  badgeClassName: string;
  tag?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg bg-white p-[var(--space-md)] text-left shadow-sm ${
        selected ? "ring-2 ring-primary/40" : "hover:bg-background-alt"
      }`}
    >
      <div className="flex items-center gap-[var(--space-md)]">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-background-alt">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-text-primary">{name}</p>
          <p className="truncate text-caption text-text-secondary">{description}</p>
          {tag && <p className="truncate text-caption font-semibold text-primary-700">{tag}</p>}
        </div>
        <span className={`hidden shrink-0 rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold sm:block ${badgeClassName}`}>
          {badgeLabel}
        </span>
        <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
      </div>
    </button>
  );
}

// An integration not yet connected — the row itself isn't clickable, only
// its action button is (either starts a connect flow directly, or opens a
// setup guide in the shared detail panel).
function AvailableRow({
  icon,
  name,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  variant = "primary",
}: {
  icon: ReactNode;
  name: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  variant?: "primary" | "outline";
}) {
  return (
    <div className="rounded-lg bg-white p-[var(--space-md)] shadow-sm">
      <div className="flex items-center gap-[var(--space-md)]">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-background-alt">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-text-primary">{name}</p>
          <p className="truncate text-caption text-text-secondary">{description}</p>
        </div>
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className={`shrink-0 rounded-pill px-[var(--space-md)] py-[var(--space-xs)] text-caption font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
            variant === "primary"
              ? "bg-primary text-white hover:bg-primary-700"
              : "border border-border text-text-primary hover:bg-background-alt"
          }`}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function McpStep({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-[var(--space-sm)]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-bold text-primary-700">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-text-primary">{title}</p>
        <div className="mt-[var(--space-xs)]">{children}</div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-[var(--space-sm)] py-[var(--space-sm)]">
      <span className="shrink-0 text-body-sm text-text-secondary">{label}</span>
      <span className="min-w-0 truncate text-right text-body-sm font-semibold text-text-primary">{value}</span>
    </div>
  );
}

function DetailPanelShell({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-[var(--space-lg)]">
      <div className="flex items-start justify-between gap-[var(--space-sm)]">
        <div className="min-w-0">
          <p className="truncate font-bold text-text-primary">{title}</p>
          <p className="text-caption text-text-secondary">{subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-text-secondary hover:text-text-primary">
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      {children}
    </div>
  );
}

function formatConnectedDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AccountingSoftwaresContent() {
  const dispatch = useAppDispatch();

  const [driveConnected, setDriveConnected] = useState(false);
  const [driveStatusLoading, setDriveStatusLoading] = useState(true);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveDisconnecting, setDriveDisconnecting] = useState(false);
  // Client-side only — see the storage.ts comment on setDriveConnectedAt.
  const [driveConnectedAt, setDriveConnectedAt] = useState<string | null>(null);

  const [detail, setDetail] = useState<DetailView>(null);
  const [disconnectedExpanded, setDisconnectedExpanded] = useState(false);

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
    handleConnect,
    handleSwitch,
    handleReconnect,
    handleDisconnect,
  } = useQuickBooksConnections("/accounting-software");

  const selectedConnection: QBConnection | null =
    detail?.type === "connection" ? connections.find((c) => c._id === detail.id) || null : null;
  const isSelectedDisconnected = selectedConnection?.status === "disconnected";
  const isSelectedReconnectRequired = selectedConnection?.status === "reconnect_required";

  const closeDetail = () => setDetail(null);

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
    // /google-drive landing page bounces back here) and a disconnect done in
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

  const handleDisconnectSelected = async () => {
    if (!selectedConnection) return;
    const success = await handleDisconnect(selectedConnection);
    if (success) closeDetail();
  };

  const driveConnectActionLabel = driveConnecting ? "Connecting…" : driveStatusLoading ? "Checking…" : "Connect";
  const qbConnectActionLabel = connecting
    ? "Connecting…"
    : checkingStatus
      ? "Checking…"
      : activeConnections.length > 0
        ? "Add account"
        : "Connect";

  const connectedCount = activeConnections.length + (driveConnected ? 1 : 0);
  const showConnectedSection =
    checkingStatus || activeConnections.length > 0 || driveConnected || disconnectedConnections.length > 0;

  return (
    <div className="mx-auto max-w-6xl p-[var(--space-lg)]">
      <h1 className="text-h2 font-bold text-trust-navy">Integrations</h1>
      <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
        Connect the accounting software and tools you use with Scantrix.
      </p>

      <div className="mt-[var(--space-lg)] flex flex-col gap-[var(--space-lg)] lg:flex-row lg:items-start">
        <div className={`w-full space-y-[var(--space-xl)] transition-[width] duration-300 ease-in-out ${detail ? "lg:w-3/5" : "lg:w-full"}`}>
          {showConnectedSection && (
            <div>
              <div className="mb-[var(--space-sm)] flex items-center gap-[var(--space-sm)]">
                <p className="text-caption font-bold uppercase tracking-wide text-text-secondary">Connected</p>
                {!checkingStatus && (
                  <span className="rounded-pill bg-primary-50 px-[var(--space-sm)] py-px text-caption font-bold text-primary-700">
                    {connectedCount}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-[var(--space-sm)]">
                {checkingStatus ? (
                  <div className="rounded-lg bg-white p-[var(--space-md)] shadow-sm">
                    <p className="text-body-sm text-text-secondary">Checking accounts…</p>
                  </div>
                ) : (
                  activeConnections.map((connection) => {
                    const isActive = connection._id === activeConnectionId;
                    const needsReconnect = connection.status === "reconnect_required";
                    const isSelected = detail?.type === "connection" && detail.id === connection._id;
                    return (
                      <ConnectedRow
                        key={connection._id}
                        icon={<BrandIcon name="quickbooks" size={28} />}
                        name={connection.name}
                        description="QuickBooks Online"
                        badgeLabel={needsReconnect ? "Reconnect required" : isActive ? "Active" : "Connected"}
                        badgeClassName={
                          needsReconnect
                            ? "bg-warning/10 text-text-primary"
                            : isActive
                              ? "bg-success/10 text-success"
                              : "bg-background-alt text-text-secondary"
                        }
                        selected={isSelected}
                        onClick={() => setDetail({ type: "connection", id: connection._id })}
                      />
                    );
                  })
                )}
                {driveConnected && (
                  <ConnectedRow
                    icon={<BrandIcon name="google-drive" size={28} />}
                    name="Google Drive"
                    description="Posted invoices are copied to your Drive automatically."
                    badgeLabel="Connected"
                    badgeClassName="bg-[#0066DA]/10 text-[#0066DA]"
                    selected={detail?.type === "drive"}
                    onClick={() => setDetail({ type: "drive" })}
                  />
                )}
              </div>

              {disconnectedConnections.length > 0 && (
                <div className="mt-[var(--space-sm)] overflow-hidden rounded-lg border border-border bg-white">
                  <button
                    type="button"
                    onClick={() => setDisconnectedExpanded((v) => !v)}
                    aria-expanded={disconnectedExpanded}
                    className="flex w-full items-center justify-between gap-[var(--space-sm)] p-[var(--space-md)] text-left"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-text-primary">Disconnected accounts</p>
                      <p className="truncate text-caption text-text-secondary">
                        {disconnectedConnections.length} previously connected
                      </p>
                    </div>
                    <ChevronDown
                      size={18}
                      strokeWidth={2}
                      className={`shrink-0 text-text-secondary transition-transform ${disconnectedExpanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {disconnectedExpanded && (
                    <div className="flex flex-col gap-[var(--space-xs)] border-t border-border p-[var(--space-sm)]">
                      {disconnectedConnections.map((connection) => {
                        const isSelected = detail?.type === "connection" && detail.id === connection._id;
                        return (
                          <div
                            key={connection._id}
                            className={`rounded-md p-[var(--space-sm)] opacity-60 ${isSelected ? "bg-primary-50" : "hover:bg-background-alt"}`}
                          >
                            <button
                              type="button"
                              onClick={() => setDetail({ type: "connection", id: connection._id })}
                              className="flex w-full items-center gap-[var(--space-sm)] text-left"
                            >
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-border" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-text-primary">{connection.name}</span>
                                <span className="block text-caption text-text-secondary">Disconnected</span>
                              </span>
                              <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-text-secondary" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <p className="mb-[var(--space-sm)] text-caption font-bold uppercase tracking-wide text-text-secondary">
              Available to connect
            </p>
            <div className="flex flex-col gap-[var(--space-sm)]">
              <AvailableRow
                icon={<BrandIcon name="quickbooks" size={28} />}
                name="QuickBooks"
                description={
                  activeConnections.length > 0
                    ? "Connect another QuickBooks company to Scantrix."
                    : "Sync vendors and post invoices automatically."
                }
                actionLabel={qbConnectActionLabel}
                onAction={handleConnect}
                actionDisabled={connecting}
              />
              {!driveConnected && (
                <AvailableRow
                  icon={<BrandIcon name="google-drive" size={28} />}
                  name="Google Drive"
                  description="Save a copy of every posted invoice to your Drive."
                  actionLabel={driveConnectActionLabel}
                  onAction={handleDriveConnect}
                  actionDisabled={driveConnecting || driveStatusLoading}
                />
              )}
              <AvailableRow
                icon={<BrandIcon name="claude" size={28} />}
                name="Claude MCP"
                description="Ask Claude about your invoices and vendors from Scantrix."
                actionLabel="Setup guide"
                onAction={() => setDetail({ type: "mcp" })}
                variant="outline"
              />
            </div>
          </div>

          <div>
            <p className="mb-[var(--space-sm)] text-caption font-bold uppercase tracking-wide text-text-secondary">
              Coming soon
            </p>
            <div className="flex flex-col gap-[var(--space-sm)]">
              <ComingSoonCard icon={<BrandIcon name="sage" size={28} />} name="Sage" description="Sync Sage Business Cloud Accounting with Scantrix." />
              <ComingSoonCard icon={<BrandIcon name="xero" size={28} />} name="Xero" description="Automate invoice posting and reconciliation with Xero." />
              <ComingSoonCard
                icon={<Receipt size={26} strokeWidth={1.75} className="text-text-secondary" />}
                name="FreshBooks"
                description="Connect FreshBooks to sync bills and expenses."
              />
              <ComingSoonCard icon={<BrandIcon name="zoho" size={28} />} name="Zoho Books" description="Automate invoice posting and reconciliation with Zoho Books." />
            </div>
          </div>
        </div>

        {/* Shared detail panel — always mounted so the width/slide transition
            has something to animate between; content swaps based on `detail`. */}
        <div
          className={`w-full overflow-hidden transition-all duration-300 ease-in-out lg:shrink-0 ${
            detail
              ? "max-h-[1200px] opacity-100 lg:w-2/5 lg:translate-x-0"
              : "pointer-events-none max-h-0 opacity-0 lg:w-0 lg:-translate-x-4"
          }`}
        >
          {detail?.type === "connection" && selectedConnection && (
            <DetailPanelShell
              title={selectedConnection.name}
              subtitle={
                isSelectedDisconnected
                  ? "Disconnected"
                  : isSelectedReconnectRequired
                    ? "Needs reconnect"
                    : selectedConnection._id === activeConnectionId
                      ? "Active connection"
                      : "Inactive"
              }
              onClose={closeDetail}
            >
              <div className="mt-[var(--space-md)] flex flex-col divide-y divide-border">
                <DetailRow
                  label={isSelectedDisconnected ? "Disconnected on" : "Connected on"}
                  value={formatConnectedDate(isSelectedDisconnected ? selectedConnection.updatedAt : selectedConnection.createdAt)}
                />
                <DetailRow label="Realm ID" value={selectedConnection.realmId} />
                <DetailRow label="User type" value={capitalizeWords(selectedConnection.role)} />
              </div>

              <div className="mt-[var(--space-lg)] flex flex-col gap-[var(--space-sm)]">
                {!isSelectedDisconnected && selectedConnection._id !== activeConnectionId && (
                  <button
                    type="button"
                    onClick={() => handleSwitch(selectedConnection)}
                    className="h-11 w-full rounded-md border border-border font-bold text-text-primary hover:bg-background-alt"
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
                  className="h-11 w-full rounded-md border border-border font-bold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reconnectingId === selectedConnection._id ? "Reconnecting…" : "Reconnect"}
                </button>
                {!isSelectedDisconnected && (
                  <button
                    type="button"
                    onClick={handleDisconnectSelected}
                    disabled={disconnectingId === selectedConnection._id}
                    className="h-11 w-full rounded-md bg-error/10 font-bold text-error disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {disconnectingId === selectedConnection._id ? "Disconnecting…" : "Disconnect"}
                  </button>
                )}
              </div>
            </DetailPanelShell>
          )}

          {detail?.type === "drive" && driveConnected && (
            <DetailPanelShell title="Google Drive" subtitle="Connected account details" onClose={closeDetail}>
              <div className="mt-[var(--space-md)] flex flex-col divide-y divide-border">
                <DetailRow label="Connected on" value={formatConnectedDate(driveConnectedAt)} />
                <DetailRow
                  label="Linked QuickBooks company"
                  value={activeConnections.find((c) => c._id === activeConnectionId)?.name || "—"}
                />
              </div>

              <div className="mt-[var(--space-lg)] flex flex-col gap-[var(--space-sm)]">
                <button
                  type="button"
                  onClick={handleDriveConnect}
                  disabled={driveConnecting}
                  className="h-11 w-full rounded-md border border-border font-bold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {driveConnecting ? "Reconnecting…" : "Reconnect"}
                </button>
                <button
                  type="button"
                  onClick={handleDriveDisconnect}
                  disabled={driveDisconnecting}
                  className="h-11 w-full rounded-md bg-error/10 font-bold text-error disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {driveDisconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            </DetailPanelShell>
          )}

          {detail?.type === "mcp" && (
            <DetailPanelShell title="Claude MCP" subtitle="Connect Scantrix to Claude via MCP" onClose={closeDetail}>
              <div className="mt-[var(--space-lg)] flex flex-col gap-[var(--space-lg)]">
                <McpStep number={1} title="Copy your server URL">
                  <div className="flex items-center gap-[var(--space-sm)]">
                    <span className="flex-1 truncate rounded-md bg-background-soft px-[var(--space-sm)] py-[var(--space-xs)] font-mono text-caption text-text-secondary">
                      {mcpServerUrl}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyMcpUrl}
                      className="shrink-0 rounded-md border border-border px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-text-secondary hover:bg-background-alt"
                    >
                      Copy
                    </button>
                  </div>
                </McpStep>

                <McpStep number={2} title="Add Scantrix as a connector">
                  <p className="text-caption text-text-secondary">
                    <span className="font-semibold text-text-primary">Claude.ai / Claude Desktop:</span>
                  </p>
                  <ol className="mt-[var(--space-xs)] flex list-decimal flex-col gap-[var(--space-xs)] pl-[var(--space-md)] text-caption text-text-secondary">
                    <li>
                      Open <span className="font-semibold text-text-primary">Settings → Customize → Connectors</span>.
                    </li>
                    <li>
                      Click <span className="font-semibold text-text-primary">Add custom connector</span>.
                    </li>
                    <li>
                      For the name, enter <span className="font-semibold text-text-primary">Scantrix</span>.
                    </li>
                    <li>Paste the URL you copied in Step 1.</li>
                    <li>
                      Click <span className="font-semibold text-text-primary">Add</span> / <span className="font-semibold text-text-primary">Connect</span>.
                    </li>
                  </ol>
                  <p className="mt-[var(--space-sm)] text-caption text-text-secondary">
                    <span className="font-semibold text-text-primary">Claude Code:</span>
                  </p>
                  <pre className="mt-[var(--space-xs)] overflow-x-auto rounded-md bg-background-soft px-[var(--space-sm)] py-[var(--space-xs)] font-mono text-caption text-text-primary">
                    claude mcp add --transport http scantrix {mcpServerUrl}
                  </pre>
                </McpStep>

                <McpStep number={3} title="Authorize and start asking">
                  <p className="text-caption text-text-secondary">
                    Sign in with your Scantrix account when prompted, then try:
                  </p>
                  <ul className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-xs)]">
                    {[
                      "What invoices are pending review?",
                      "Show me this month's vendor totals.",
                      "Which invoices failed to post to QuickBooks?",
                    ].map((example) => (
                      <li
                        key={example}
                        className="rounded-md bg-background-soft px-[var(--space-sm)] py-[var(--space-xs)] text-caption italic text-text-secondary"
                      >
                        “{example}”
                      </li>
                    ))}
                  </ul>
                </McpStep>
              </div>
            </DetailPanelShell>
          )}
        </div>
      </div>
    </div>
  );
}
