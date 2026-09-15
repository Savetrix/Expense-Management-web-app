"use client";

// Email forwarding for ONE QuickBooks company — v2 redesign of
// src/components/accounting/EmailForwardingPanel.tsx.
//
// Lives inside the connection detail modal in AccountingSoftwaresContentV2,
// because a receiving address is per-company and that is where company-scoped
// connection state already lives. The company shown here is the company the
// address posts into — which is the whole answer to "how do I keep five
// clients apart": five companies, five addresses, no choosing at forward time.
//
// Every thunk dispatched, every guard and every early return is identical to
// the original; only markup and tokens changed (per redesign-v2).
//
// 'use client' sits on this leaf rather than on a page or layout root, per
// AGENTS.md.
import { AlertTriangle, Check, Copy, Mail, RefreshCw, Trash2 } from "lucide-react";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui";
import type { UsernameCheck } from "@/store/inboundEmail/inboundEmailApi";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearInboundEmailError } from "@/store/inboundEmail/inboundEmailSlice";
import {
  checkInboundUsername,
  claimInboundUsername,
  enableInboundForwarding,
  fetchInboundOverview,
  reconnectInboundForwarding,
  regenerateInboundAddress,
  revokeInboundForwarding,
  updateInboundSenders,
  type InboundActivityEntry,
  type InboundAlias,
} from "@/store/inboundEmail/inboundEmailApi";

interface EmailForwardingPanelV2Props {
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
  forwarded_as_attachment:
    "This was forwarded as an attachment, so the invoice is nested inside another email. Forward it normally instead, or attach the invoice file directly.",
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

const GHOST_BUTTON_CLASS =
  "flex h-10 w-full cursor-pointer items-center justify-center gap-[var(--space-xs)] rounded-md border border-border bg-surface text-body-sm font-semibold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60";
const DANGER_BUTTON_CLASS =
  "h-10 w-full cursor-pointer rounded-md border border-status-danger-border bg-status-danger-bg text-body-sm font-semibold text-status-danger-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const TEXT_INPUT_CLASS =
  "h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-[var(--space-sm)] text-body-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent/40";

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
    <div className="flex items-center gap-[var(--space-sm)] rounded-md border border-border bg-surface-alt p-[var(--space-sm)]">
      {/* break-all: these addresses are long, and truncating the one thing the
          user came here to read would be the wrong tradeoff. */}
      <code className="min-w-0 flex-1 break-all font-mono text-caption font-semibold text-content-primary">
        {address}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Address copied" : "Copy address"}
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-content-secondary hover:bg-surface-alt"
      >
        {copied ? <Check size={14} className="text-status-success-text" /> : <Copy size={14} />}
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
        <p className="min-w-0 flex-1 truncate text-caption font-semibold text-content-primary">
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
      <p className="text-tiny text-content-muted">
        {entry.senderEmail || "unknown sender"} · {formatWhen(entry.receivedAt)}
      </p>
      {reason && <p className="text-tiny text-status-danger-text">{reason}</p>}
      {/* The auth-header evidence. This is what turns "authentication_failed"
          from a mystery into a five-minute fix — see authResults.ts. */}
      {entry.authDiagnostics && entry.authDiagnostics.trust !== "verified" && (
        <details className="text-tiny text-content-secondary">
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

/**
 * Pick a custom address for this company.
 *
 * Check-then-Confirm rather than confirming straight from typing: the namespace
 * is global, so availability is a hint that can go stale between the two clicks.
 * The server re-checks atomically when confirming, and this only ever reports
 * what it says.
 */
function UsernameEditor({
  alias,
  domain,
  busy,
}: {
  alias: InboundAlias;
  domain: string;
  busy: boolean;
}) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UsernameCheck | null>(null);
  const [open, setOpen] = useState(false);

  const current = alias.receivingAddress.split("@")[0] ?? "";

  const runCheck = async () => {
    const value = draft.trim();
    if (!value || checking) return;
    setChecking(true);
    setResult(null);
    const outcome = await dispatch(checkInboundUsername({ username: value }));
    setChecking(false);
    if (checkInboundUsername.fulfilled.match(outcome)) setResult(outcome.payload);
    else showToast("Couldn't check that username. Please try again.", "error");
  };

  const confirm = async () => {
    if (!result?.available) return;
    const outcome = await dispatch(claimInboundUsername({ id: alias.id, username: result.username }));
    if (claimInboundUsername.fulfilled.match(outcome)) {
      showToast("Address updated.", "success");
      setDraft("");
      setResult(null);
      setOpen(false);
    } else {
      // Covers the check-then-claim race: available a moment ago, taken now.
      showToast(
        typeof outcome.payload?.message === "string"
          ? outcome.payload.message
          : "Couldn't set that username.",
        "error",
      );
      setResult(null);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit cursor-pointer text-caption font-semibold text-accent-text-on-bg underline"
      >
        Choose a custom address
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-sm)] rounded-md border border-border p-[var(--space-sm)]">
      <p className="text-caption text-content-secondary">
        Pick the part before the @. It must be unique across all of{" "}
        <span className="font-mono">{domain}</span>.
      </p>

      <div className="flex gap-[var(--space-sm)]">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runCheck();
            }
          }}
          placeholder={current}
          aria-label="Custom username"
          className={`${TEXT_INPUT_CLASS} font-mono`}
        />
        <button
          type="button"
          onClick={runCheck}
          disabled={checking || !draft.trim()}
          className="h-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface px-[var(--space-md)] text-body-sm font-semibold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          {checking ? "Checking…" : "Check"}
        </button>
      </div>

      {result && (
        <div className="flex flex-col gap-[var(--space-xs)]">
          {result.available ? (
            <>
              <p className="text-caption font-semibold text-status-success-text">{result.message}</p>
              <div className="rounded-md border border-border bg-surface-alt p-[var(--space-sm)]">
                <code className="break-all font-mono text-caption font-semibold text-content-primary">
                  {result.address}
                </code>
              </div>
              <p className="text-caption text-content-secondary">
                Confirming replaces the current address. Mail to{" "}
                <span className="font-mono">{alias.receivingAddress}</span> will stop arriving.
              </p>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="h-10 w-full cursor-pointer rounded-md bg-accent text-body-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving…" : "Confirm"}
              </button>
            </>
          ) : (
            <p className="text-caption text-status-danger-text">{result.message}</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setDraft("");
          setResult(null);
        }}
        className="w-fit cursor-pointer text-caption text-content-secondary underline"
      >
        Cancel
      </button>
    </div>
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
      <p className="text-caption text-content-secondary">
        Only these addresses can create invoices here. Mail from anyone else is discarded.
      </p>
      <ul className="flex flex-col gap-[var(--space-xs)]">
        <li className="flex items-center justify-between gap-[var(--space-sm)] text-caption">
          <span className="min-w-0 break-all text-content-primary">{alias.ownerEmail}</span>
          <Badge variant="neutral">You</Badge>
        </li>
        {alias.additionalSenders.map((address) => (
          <li key={address} className="flex items-center justify-between gap-[var(--space-sm)] text-caption">
            <span className="min-w-0 break-all text-content-primary">{address}</span>
            <button
              type="button"
              onClick={() => remove(address)}
              disabled={busy}
              aria-label={`Remove ${address}`}
              className="shrink-0 cursor-pointer rounded-md p-[var(--space-xs)] text-content-secondary hover:text-status-danger-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={14} />
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
          className={TEXT_INPUT_CLASS}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !draft.trim()}
          className="h-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface px-[var(--space-md)] text-body-sm font-semibold text-content-primary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function EmailForwardingPanelV2({
  qbConnectionId,
  companyName,
  disabled = false,
}: EmailForwardingPanelV2Props) {
  const dispatch = useAppDispatch();
  const { loading, loaded, error, missingConfig, enabled, domain, aliases, recentActivity, busyAliasId, enablingConnectionId } =
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
  // Deployment isn't configured for this feature — show NOTHING.
  //
  // An earlier version rendered the list of missing environment variable names
  // here. That is a deployment diagnostic, not customer-facing copy: between
  // merging this feature and setting the production variables, every accountant
  // opening a company would have been shown INBOUND_PROVIDER_API_KEY and
  // friends. The server already logs `[inbound] misconfigured: …` where an
  // operator will actually see it.
  if (missingConfig.length > 0) return null;

  if (loading && !loaded) {
    return (
      <Section>
        <p className="text-caption text-content-secondary">Loading email forwarding…</p>
      </Section>
    );
  }

  // ── Feature is off server-side ──────────────────────────────────────────
  // Hide it entirely rather than offering a button that mints an address no
  // mail can reach. This is what makes INBOUND_EMAIL_ENABLED a usable rollout
  // switch: off means the feature does not exist as far as the user is
  // concerned. An alias that ALREADY exists still renders below, so turning the
  // flag off never hides an address somebody has already saved and shared.
  if (!enabled && !alias) return null;

  // ── Not enabled for this company ────────────────────────────────────────
  if (!alias) {
    return (
      <Section>
        {/* An earlier version returned EARLY here whenever `error` was set,
            which removed the button below — so a single failed attempt trapped
            the user in an error state with no way to retry short of reloading
            the page. The error now sits ABOVE a still-usable button. */}
        {error && (
          <div className="flex flex-col gap-[var(--space-xs)] rounded-md border border-status-danger-border bg-status-danger-bg p-[var(--space-sm)]">
            <p className="text-caption text-status-danger-text">{error}</p>
            <button
              type="button"
              onClick={() => {
                dispatch(clearInboundEmailError());
                dispatch(fetchInboundOverview());
              }}
              className="w-fit cursor-pointer text-caption font-semibold text-content-primary underline"
            >
              Dismiss and refresh
            </button>
          </div>
        )}
        <p className="text-caption text-content-secondary">
          Give this company its own address, then forward supplier invoices straight to it — no
          downloading and re-uploading. They land in the same review queue as an upload.
        </p>
        <button type="button" onClick={handleEnable} disabled={enabling || disabled} className={GHOST_BUTTON_CLASS}>
          {enabling ? "Setting up…" : disabled ? "Reconnect QuickBooks first" : "Turn on email forwarding"}
        </button>
      </Section>
    );
  }

  // ── Enabled ─────────────────────────────────────────────────────────────
  return (
    <Section>
      <div className="flex items-center justify-between gap-[var(--space-sm)]">
        <p className="text-tiny font-bold uppercase tracking-wide text-content-secondary">Forward invoices to</p>
        <Badge variant={alias.delegationActive ? "success" : "error"}>
          {alias.delegationActive ? "Active" : "Needs reconnect"}
        </Badge>
      </div>

      <CopyableAddress address={alias.receivingAddress} />

      {!enabled && (
        <p className="flex items-start gap-[var(--space-xs)] text-caption text-status-warning-text">
          <AlertTriangle size={13} className="mt-[2px] shrink-0" />
          Forwarding is paused right now. Mail to this address is recorded and will be imported once
          it&apos;s switched back on — nothing is lost.
        </p>
      )}

      <UsernameEditor alias={alias} domain={domain} busy={busy} />

      <p className="text-caption text-content-secondary">
        Invoices sent here are filed under <span className="font-semibold text-content-primary">{companyName}</span>.
        PDFs and images, up to 10 per email. Last used: {formatWhen(alias.lastUsedAt)}.
      </p>

      {!alias.delegationActive && (
        <div className="flex flex-col gap-[var(--space-sm)] rounded-md border border-status-danger-border bg-status-danger-bg p-[var(--space-sm)]">
          <p className="text-caption text-status-danger-text">
            Email forwarding has lost access to this company, so new invoices can&apos;t be created.
            Reconnect to restore it — the address stays the same.
          </p>
          <button type="button" onClick={handleReconnect} disabled={busy} className={GHOST_BUTTON_CLASS}>
            {busy ? "Reconnecting…" : "Reconnect"}
          </button>
        </div>
      )}

      <SenderEditor alias={alias} busy={busy} />

      {activity.length > 0 && (
        <div className="flex flex-col">
          <p className="text-tiny font-bold uppercase tracking-wide text-content-secondary">Recent email imports</p>
          <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto">
            {activity.map((entry) => (
              <ActivityRow key={entry.correlationId} entry={entry} />
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-[var(--space-sm)]">
        <button type="button" onClick={handleRegenerate} disabled={busy} className={GHOST_BUTTON_CLASS}>
          <RefreshCw size={14} />
          {busy ? "Working…" : "Generate a new address"}
        </button>
        <button type="button" onClick={handleRevoke} disabled={busy} className={DANGER_BUTTON_CLASS}>
          Turn off email forwarding
        </button>
      </div>
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)] border-t border-border pt-[var(--space-md)]">
      <div className="flex items-center gap-[var(--space-xs)]">
        <Mail size={14} className="text-content-secondary" />
        <p className="text-body-sm font-semibold text-content-primary">Email forwarding</p>
      </div>
      {children}
    </div>
  );
}
