"use client";

import { ArrowRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Card } from "@/components/ui/Card";
import { showToast } from "@/lib/dialogManager";
import { useQuickBooksConnections } from "@/store/quickBooks/useQuickBooksConnections";

export function QuickBooksConnectContent() {
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
  } = useQuickBooksConnections("/quickbooks");

  // Backend's QB OAuth callback redirects errors back here as ?error=<code>
  // (success carries no query param — the hook's own checkStatus already
  // re-fetches the connection list, which is enough to reflect a successful
  // connect).
  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    showToast(error, "error");
    router.replace("/quickbooks");
  }, [searchParams, router]);

  return (
    <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
      <h1 className="text-h2 font-bold text-trust-navy">QuickBooks</h1>
      <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
        Manage the QuickBooks companies connected to Scantrix.
      </p>

      {checkingStatus ? (
        <p className="mt-[var(--space-lg)] text-body-sm text-text-secondary">Checking accounts…</p>
      ) : (
        <div className="mt-[var(--space-lg)] flex flex-col gap-[var(--space-sm)]">
          {connections.length === 0 && (
            <Card className="text-center text-body-sm text-text-secondary">
              No QuickBooks accounts connected yet.
            </Card>
          )}

          {connections.map((connection) => {
            const isActive = connection._id === activeConnectionId;
            const needsReconnect = connection.status === "reconnect_required";
            const date = new Date(connection.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            return (
              <Card
                key={connection._id}
                className={`flex flex-col items-start gap-[var(--space-sm)] lg:flex-row lg:items-center lg:justify-between ${isActive ? "border-primary" : ""}`}
              >
                <div className="flex min-w-0 items-center gap-[var(--space-sm)]">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${needsReconnect ? "bg-warning" : isActive ? "bg-primary" : "bg-border"}`} />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-text-primary">{connection.name}</p>
                    <p className={`truncate text-caption ${needsReconnect ? "font-semibold text-warning" : "text-text-secondary"}`}>
                      {needsReconnect ? "Needs reconnect — QuickBooks revoked access" : `Connected ${date}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => handleSwitch(connection)}
                      className="text-body-sm font-semibold text-primary"
                    >
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
                    className="text-body-sm font-semibold text-primary disabled:opacity-60"
                  >
                    {reconnectingId === connection._id ? "…" : "Reconnect"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisconnect(connection)}
                    disabled={disconnectingId === connection._id}
                    className="rounded-md bg-error/10 px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-error disabled:opacity-60"
                  >
                    {disconnectingId === connection._id ? "…" : "Disconnect"}
                  </button>
                </div>
              </Card>
            );
          })}

          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="mt-[var(--space-sm)] flex h-12 items-center justify-center gap-[var(--space-xs)] rounded-md bg-primary font-bold text-white disabled:opacity-60"
          >
            {connecting ? "Connecting…" : connections.length > 0 ? "Add Another Account" : "Connect QuickBooks"}
            <ArrowRight size={16} strokeWidth={2.25} />
          </button>
        </div>
      )}
    </div>
  );
}
