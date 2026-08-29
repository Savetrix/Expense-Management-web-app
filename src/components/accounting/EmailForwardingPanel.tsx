"use client";

// Email forwarding for ONE QuickBooks company.
//
// Lives inside the connection detail panel in AccountingSoftwaresContent,
// because a receiving address is per-company and that is where company-scoped
// connection state already lives (§23). The company shown here is the company
// the address posts into — which is the whole answer to "how do I keep five
// clients apart": five companies, five addresses, no choosing at forward time.
//
// 'use client' sits on this leaf rather than on a page or layout root, per
// AGENTS.md.
import { AlertTriangle, Check, Copy, Mail, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearInboundEmailError } from "@/store/inboundEmail/inboundEmailSlice";
import {
  enableInboundForwarding,
  fetchInboundOverview,
  reconnectInboundForwarding,
  regenerateInboundAddress,
  revokeInboundForwarding,
  updateInboundSenders,
  type InboundActivityEntry,
  type InboundAlias,
} from "@/store/inboundEmail/inboundEmailApi";

interface EmailForwardingPanelProps {
  qbConnectionId: string;
  companyName: string;
  /** Forwarding into a disconnected company would fail on arrival. */
  disabled?: boolean;
}

/** Statuses that mean an invoice really was created. */
const SUCCESS_STATUSES = new Set(["completed", "partially_completed"]);

/**
 * Rejection codes rendered as something an accountant can act on. Anything not
 * listed falls back to the raw code, which is still better than "failed" — a
 * support conversation can start from it.
 */
const REJECTION_COPY: Record<string, string> = {
  unknown_alias: "Sent to an address that no longer exists.",
  feature_disabled: "Email forwarding is turned off.",
  sender_not_registered: "That sender isn't allowed to forward to this address.",
  sender_not_verified: "That sender's email address isn't verified yet.",
  sender_not_authorized: "That sender can't upload to this company.",
  account_inactive: "The account that owns this address is inactive.",
  authentication_failed: "The email failed sender authentication checks.",
  automated_message: "Looked like an auto-reply or bounce, not an invoice.",
  no_supported_attachments: "No invoice attachment found — only images or inline logos.",
  unsupported_file_type: "Attachment wasn't a PDF or an image.",
  content_type_mismatch: "Attachment's contents didn't match its file type.",
  file_too_large: "Attachment was too large.",
  too_many_attachments: "Too many attachments in one email.",
  duplicate_attachment: "The same file appeared twice.",
  credential_expired: "Email forwarding lost access to this company — reconnect below.",
  ingestion_failed: "The invoice couldn't be processed.",
  attachment_download_failed: "We couldn't retrieve the attachment from the mail provider.",
  invalid_payload: "The email couldn't be read.",
  usage_limit_exceeded: "Your plan's invoice limit was reached.",
};

function formatWhen(value: string | null): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      // Reset so the affordance stays available for a second copy.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked by permissions or an insecure context. Say so
      // rather than appearing to have copied nothing.
      showToast("Couldn't copy. Select the address and copy it manually.", "error");
    }
  };

  return (
    <div className="flex items-center gap-[var(--space-sm)] rounded-md bg-background-alt p-[var(--space-sm)]">
      {/* break-all: these addresses are long, and truncating the one thing the
          user came here to read would be the wrong tradeoff. */}
      <code className="min-w-0 flex-1 break-all text-body-sm font-semibold text-text-primary">
        {address}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Address copied" : "Copy address"}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-white text-text-secondary hover:bg-background-alt"
      >
        {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
      </button>
    </div>
  );
}

function ActivityRow({ entry }: { entry: InboundActivityEntry }) {
  const succeeded = SUCCESS_STATUSES.has(entry.status);
  const reason = entry.rejectionCode
    ? (REJECTION_COPY[entry.rejectionCode] ?? entry.rejectionCode)
    : null;

  return (
    <li className="flex flex-col gap-[var(--space-xs)] py-[var(--space-sm)]">
      <div className="flex items-start justify-between gap-[var(--space-sm)]">
        <p className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
          {entry.subject || "(no subject)"}
        </p>
        <Badge variant={succeeded ? "success" : entry.status === "received" ? "neutral" : "error"}>
          {succeeded
            ? entry.invoiceCount === 1
              ? "1 invoice"
              : `${entry.invoiceCount} invoices`
            : entry.status === "received"
              ? "Queued"
              : "Rejected"}
        </Badge>
      </div>
      <p className="text-caption text-text-secondary">
        {entry.senderEmail || "unknown sender"} · {formatWhen(entry.receivedAt)}
      </p>
      {reason && <p className="text-caption text-error">{reason}</p>}
      {/* The auth-header evidence. This is what turns "authentication_failed"
          from a mystery into a five-minute fix — see authResults.ts. */}
      {entry.authDiagnostics && entry.authDiagnostics.trust !== "verified" && (
        <details className="text-caption text-text-secondary">
          <summary className="cursor-pointer">Sender authentication details</summary>
          <dl className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-xs)]">
            <div>
              <dt className="inline font-semibold">Trust: </dt>
              <dd className="inline">
                {entry.authDiagnostics.trust === "absent"
                  ? "no authentication header arrived"
                  : entry.authDiagnostics.trust === "rejected"
                    ? "header did not match the pinned server id"
                    : "header present but unverified (no INBOUND_EXPECTED_AUTHSERV_ID set)"}
              </dd>
            </div>
            {entry.authDiagnostics.authservId && (
              <div>
                <dt className="inline font-semibold">Reported by: </dt>
                <dd className="inline break-all">{entry.authDiagnostics.authservId}</dd>
              </div>
            )}
            {entry.authDiagnostics.authenticationResults && (
              <div>
                <dt className="font-semibold">Authentication-Results</dt>
                <dd className="break-all font-mono">{entry.authDiagnostics.authenticationResults}</dd>
              </div>
            )}
            {entry.authDiagnostics.receivedSpf && (
              <div>
                <dt className="font-semibold">Received-SPF</dt>
                <dd className="break-all font-mono">{entry.authDiagnostics.receivedSpf}</dd>
              </div>
            )}
          </dl>
        </details>
      )}
    </li>
  );
}

function SenderEditor({ alias, busy }: { alias: InboundAlias; busy: boolean }) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState("");

  const add = async () => {
    const value = draft.trim();
    if (!value) return;
    const result = await dispatch(
      updateInboundSenders({
        id: alias.id,
        additionalSenders: [...alias.additionalSenders, value],
      }),
    );
    if (updateInboundSenders.fulfilled.match(result)) {
      setDraft("");
      showToast("Sender added.", "success");
    } else {
      showToast(
        typeof result.payload?.message === "string" ? result.payload.message : "Couldn't add sender.",
        "error",
      );
    }
  };

  const remove = async (address: string) => {
    const result = await dispatch(
      updateInboundSenders({
        id: alias.id,
        additionalSenders: alias.additionalSenders.filter((entry) => entry !== address),
      }),
    );
    if (!updateInboundSenders.fulfilled.match(result)) {
      showToast("Couldn't remove sender.", "error");
    }
  };

  return (
    <div className="flex flex-col gap-[var(--space-sm)]">
      <p className="text-caption text-text-secondary">
        Only these addresses can create invoices here. Mail from anyone else is discarded.
      </p>
      <ul className="flex flex-col gap-[var(--space-xs)]">
        <li className="flex items-center justify-between gap-[var(--space-sm)] text-body-sm">
          <span className="min-w-0 break-all text-text-primary">{alias.ownerEmail}</span>
          <Badge variant="neutral">You</Badge>
        </li>
        {alias.additionalSenders.map((address) => (
          <li key={address} className="flex items-center justify-between gap-[var(--space-sm)] text-body-sm">
            <span className="min-w-0 break-all text-text-primary">{address}</span>
            <button
              type="button"
              onClick={() => remove(address)}
              disabled={busy}
              aria-label={`Remove ${address}`}
              className="shrink-0 cursor-pointer rounded-md p-[var(--space-xs)] text-text-secondary hover:text-error disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-[var(--space-sm)]">
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="colleague@company.com"
          className="h-10 min-w-0 flex-1 rounded-md border border-border px-[var(--space-sm)] text-body-sm text-text-primary"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !draft.trim()}
          className="h-10 shrink-0 cursor-pointer rounded-md border border-border px-[var(--space-md)] text-body-sm font-bold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function EmailForwardingPanel({
  qbConnectionId,
  companyName,
  disabled = false,
}: EmailForwardingPanelProps) {
  const dispatch = useAppDispatch();
  const { loading, loaded, error, missingConfig, enabled, aliases, recentActivity, busyAliasId, enablingConnectionId } =
    useAppSelector((state) => state.inboundEmail);

  useEffect(() => {
    // One fetch per mount; the panel only appears when a connection is opened.
    if (!loaded && !loading) dispatch(fetchInboundOverview());
  }, [dispatch, loaded, loading]);

  const alias = useMemo(
    () => aliases.find((entry) => entry.qbConnectionId === qbConnectionId && entry.active) ?? null,
    [aliases, qbConnectionId],
  );

  // Activity is stored per user across all companies, so scope it to this one.
  const activity = useMemo(
    () =>
      recentActivity
        .filter((entry) =>
          // Match on the connection id. Entries written before that field
          // existed carry only a name, so fall back for those rather than
          // hiding a user's earlier history.
          entry.qbConnectionId
            ? entry.qbConnectionId === qbConnectionId
            : entry.companyName === companyName,
        )
        .slice(0, 8),
    [recentActivity, companyName, qbConnectionId],
  );

  const busy = busyAliasId === alias?.id;
  const enabling = enablingConnectionId === qbConnectionId;

  const handleEnable = useCallback(async () => {
    const result = await dispatch(enableInboundForwarding({ qbConnectionId }));
    if (enableInboundForwarding.fulfilled.match(result)) {
      showToast("Email forwarding is on for this company.", "success");
    } else {
      showToast(
        typeof result.payload?.message === "string"
          ? result.payload.message
          : "Couldn't turn on email forwarding.",
        "error",
      );
    }
  }, [dispatch, qbConnectionId]);

  const handleRegenerate = useCallback(async () => {
    if (!alias) return;
    const confirmed = await confirmDialog({
      title: "Generate a new address?",
      message:
        `The current address stops working immediately.\n\n${alias.receivingAddress}\n\n` +
        "Anything forwarded to it after this will be discarded, so update any saved contacts or supplier auto-forwards.",
      confirmLabel: "Generate new address",
      tone: "destructive",
    });
    if (!confirmed) return;

    const result = await dispatch(regenerateInboundAddress({ id: alias.id }));
    if (regenerateInboundAddress.fulfilled.match(result)) {
      showToast("New address generated.", "success");
    } else {
      showToast("Couldn't generate a new address.", "error");
    }
  }, [alias, dispatch]);

  const handleRevoke = useCallback(async () => {
    if (!alias) return;
    const confirmed = await confirmDialog({
      title: "Turn off email forwarding?",
      message:
        `${alias.receivingAddress} will stop accepting invoices immediately, and the stored session used to create them is deleted.\n\n` +
        "Invoices already imported are unaffected.",
      confirmLabel: "Turn off",
      tone: "destructive",
    });
    if (!confirmed) return;

    const result = await dispatch(revokeInboundForwarding({ id: alias.id, purge: true }));
    if (revokeInboundForwarding.fulfilled.match(result)) {
      showToast("Email forwarding turned off.", "success");
    } else {
      showToast("Couldn't turn off email forwarding.", "error");
    }
  }, [alias, dispatch]);

  const handleReconnect = useCallback(async () => {
    if (!alias) return;
    const result = await dispatch(reconnectInboundForwarding({ id: alias.id }));
    if (reconnectInboundForwarding.fulfilled.match(result)) {
      showToast("Email forwarding reconnected.", "success");
    } else {
      showToast(
        typeof result.payload?.message === "string" ? result.payload.message : "Couldn't reconnect.",
        "error",
      );
    }
  }, [alias, dispatch]);

  // ── Deployment isn't configured for this yet ────────────────────────────
  if (missingConfig.length > 0) {
    return (
      <Section>
        <p className="text-caption text-text-secondary">
          Email forwarding isn&apos;t set up on this deployment yet. Missing configuration:{" "}
          <span className="font-mono">{missingConfig.join(", ")}</span>
        </p>
      </Section>
    );
  }

  if (loading && !loaded) {
    return (
      <Section>
        <p className="text-caption text-text-secondary">Loading email forwarding…</p>
      </Section>
    );
  }

  // ── Not enabled for this company ────────────────────────────────────────
  if (!alias) {
    return (
      <Section>
        {/* An earlier version returned EARLY here whenever `error` was set,
            which removed the button below — so a single failed attempt trapped
            the user in an error state with no way to retry short of reloading
            the page. The error now sits ABOVE a still-usable button. */}
        {error && (
          <div className="flex flex-col gap-[var(--space-xs)] rounded-md bg-error/10 p-[var(--space-sm)]">
            <p className="text-caption text-error">{error}</p>
            <button
              type="button"
              onClick={() => {
                dispatch(clearInboundEmailError());
                dispatch(fetchInboundOverview());
              }}
              className="w-fit cursor-pointer text-caption font-bold text-text-primary underline"
            >
              Dismiss and refresh
            </button>
          </div>
        )}
        <p className="text-body-sm text-text-secondary">
          Give this company its own address, then forward supplier invoices straight to it — no
          downloading and re-uploading. They land in the same review queue as an upload.
        </p>
        {!enabled && (
          <p className="flex items-start gap-[var(--space-xs)] text-caption text-warning">
            <AlertTriangle size={14} className="mt-[2px] shrink-0" />
            Forwarding is switched off server-side right now. You can create the address, but nothing
            will be imported until it&apos;s enabled.
          </p>
        )}
        <button
          type="button"
          onClick={handleEnable}
          disabled={enabling || disabled}
          className="h-11 w-full cursor-pointer rounded-md border border-border font-bold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enabling ? "Setting up…" : disabled ? "Reconnect QuickBooks first" : "Turn on email forwarding"}
        </button>
      </Section>
    );
  }

  // ── Enabled ─────────────────────────────────────────────────────────────
  return (
    <Section>
      <div className="flex items-center justify-between gap-[var(--space-sm)]">
        <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
          Forward invoices to
        </p>
        <Badge variant={alias.delegationActive ? "success" : "error"}>
          {alias.delegationActive ? "Active" : "Needs reconnect"}
        </Badge>
      </div>

      <CopyableAddress address={alias.receivingAddress} />

      <p className="text-caption text-text-secondary">
        Invoices sent here are filed under <span className="font-semibold">{companyName}</span>.
        PDFs and images, up to 10 per email. Last used: {formatWhen(alias.lastUsedAt)}.
      </p>

      {!alias.delegationActive && (
        <div className="flex flex-col gap-[var(--space-sm)] rounded-md bg-error/10 p-[var(--space-sm)]">
          <p className="text-caption text-error">
            Email forwarding has lost access to this company, so new invoices can&apos;t be created.
            Reconnect to restore it — the address stays the same.
          </p>
          <button
            type="button"
            onClick={handleReconnect}
            disabled={busy}
            className="h-10 w-full cursor-pointer rounded-md bg-white font-bold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Reconnecting…" : "Reconnect"}
          </button>
        </div>
      )}

      <SenderEditor alias={alias} busy={busy} />

      {activity.length > 0 && (
        <div className="flex flex-col">
          <p className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
            Recent email imports
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {activity.map((entry) => (
              <ActivityRow key={entry.correlationId} entry={entry} />
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-[var(--space-sm)]">
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={busy}
          className="flex h-11 w-full cursor-pointer items-center justify-center gap-[var(--space-xs)] rounded-md border border-border font-bold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={15} />
          {busy ? "Working…" : "Generate a new address"}
        </button>
        <button
          type="button"
          onClick={handleRevoke}
          disabled={busy}
          className="h-11 w-full cursor-pointer rounded-md bg-error/10 font-bold text-error disabled:cursor-not-allowed disabled:opacity-60"
        >
          Turn off email forwarding
        </button>
      </div>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[var(--space-lg)] flex flex-col gap-[var(--space-sm)] border-t border-border pt-[var(--space-md)]">
      <div className="flex items-center gap-[var(--space-xs)]">
        <Mail size={15} className="text-text-secondary" />
        <p className="font-bold text-text-primary">Email forwarding</p>
      </div>
      {children}
    </div>
  );
}
