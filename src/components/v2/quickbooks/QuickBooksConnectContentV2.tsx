"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronRight, Plug } from "lucide-react";
import { useEffect } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { useQuickBooksConnections } from "@/store/quickBooks/useQuickBooksConnections";

// v2 redesign of src/components/quickbooks/QuickBooksConnectContent.tsx — the
// dedicated QuickBooks route the OAuth callback can land on. Full connection
// management lives on /v2/accounting-software; this stays the focused
// companies-only view, sharing the same useQuickBooksConnections hook so the
// two surfaces never drift apart.
const ROW_ACTION_CLASS =
  "flex h-8 shrink-0 cursor-pointer items-center gap-[var(--space-xs)] rounded-md border border-border bg-surface px-[var(--space-sm)] text-caption font-semibold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60";
const ROW_DANGER_CLASS =
  "flex h-8 shrink-0 cursor-pointer items-center rounded-md border border-status-danger-border bg-status-danger-bg px-[var(--space-sm)] text-caption font-semibold text-status-danger-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

export function QuickBooksConnectContentV2() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    activeConnections: connections,
    checkingStatus,
    connecting,
    disconnectingId,
    reconnectingId,
    activeConnectionId,
    handleSwitch,
    handleConnect,
    handleReconnect,
    handleDisconnect,
  } = useQuickBooksConnections("/v2/quickbooks");

  // Backend's QB OAuth callback redirects errors back here as ?error=<code>
  // (success carries no query param — the hook's own checkStatus already
  // re-fetches the connection list, which is enough to reflect a successful
  // connect).
  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    showToast(error, "error");
    router.replace("/v2/quickbooks");
  }, [searchParams, router]);

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <p className="mb-[var(--space-xs)] flex items-center gap-[var(--space-xs)] text-tiny font-bold uppercase tracking-[0.08em] text-accent-text-on-bg">
        Integrations
        <ChevronRight size={11} strokeWidth={2.5} className="text-content-muted" />
        QuickBooks
      </p>

      <PageHeader
        title="QuickBooks"
        subtitle="Manage the QuickBooks companies connected to Scantrix."
        action={
          <Button type="button" size="sm" onClick={handleConnect} loading={connecting} className="shrink-0">
            {!connecting && <Plug size={14} strokeWidth={2.25} />}
            {connections.length > 0 ? "Add another account" : "Connect QuickBooks"}
          </Button>
        }
      />

      <div className="mt-[var(--space-lg)]">
        <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">
          Connected companies
          {!checkingStatus && connections.length > 0 && (
            <span className="ml-[var(--space-sm)] rounded-pill bg-accent-bg px-[var(--space-sm)] text-tiny font-bold text-accent-text-on-bg">
              {connections.length}
            </span>
          )}
        </p>

        {checkingStatus ? (
          <SkeletonListRows count={2} />
        ) : connections.length === 0 ? (
          <div className="rounded-md border border-border bg-surface">
            <EmptyState
              icon={<BrandIcon name="quickbooks" size={26} />}
              title="No QuickBooks companies yet"
              description="Connect a company to sync its vendors, GL accounts and tax codes, and to post approved invoices."
              actionLabel={connecting ? "Connecting…" : "Connect QuickBooks"}
              onAction={handleConnect}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-sm)]">
            {connections.map((connection) => {
              const isActive = connection._id === activeConnectionId;
              const needsReconnect = connection.status === "reconnect_required";
              const date = new Date(connection.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              return (
                <div
                  key={connection._id}
                  className={`flex flex-col gap-[var(--space-sm)] rounded-md border bg-surface px-[var(--space-md)] py-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between ${
                    isActive ? "border-accent ring-1 ring-accent/30" : "border-border"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-[var(--space-md)]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
                      <BrandIcon name="quickbooks" size={22} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-semibold text-content-primary">{connection.name}</p>
                      <p
                        className={`truncate text-caption ${
                          needsReconnect ? "font-semibold text-status-warning-text" : "text-content-secondary"
                        }`}
                      >
                        {needsReconnect ? "Needs reconnect — QuickBooks revoked access" : `Connected ${date}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                    <Badge variant={needsReconnect ? "warning" : isActive ? "success" : "neutral"}>
                      {needsReconnect ? "Reconnect required" : isActive ? "Active" : "Connected"}
                    </Badge>
                    {!isActive && (
                      <button type="button" onClick={() => handleSwitch(connection)} className={ROW_ACTION_CLASS}>
                        Switch
                      </button>
                    )}
                    {/* Reconnect is offered for every live connection, not just
                        owner/admin: reconnecting re-runs the OAuth flow for THIS
                        connection and rotates its tokens, which is how an active
                        account gets refreshed when access starts failing. The
                        backend still enforces whatever role it enforces. */}
                    <button
                      type="button"
                      onClick={() => handleReconnect(connection)}
                      disabled={reconnectingId === connection._id}
                      className={ROW_ACTION_CLASS}
                    >
                      {reconnectingId === connection._id ? "Reconnecting…" : "Reconnect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDisconnect(connection)}
                      disabled={disconnectingId === connection._id}
                      className={ROW_DANGER_CLASS}
                    >
                      {disconnectingId === connection._id ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              size="sm"
              onClick={handleConnect}
              loading={connecting}
              className="mt-[var(--space-xs)] self-start"
            >
              {connections.length > 0 ? "Add another account" : "Connect QuickBooks"}
              {!connecting && <ArrowRight size={14} strokeWidth={2.25} />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
