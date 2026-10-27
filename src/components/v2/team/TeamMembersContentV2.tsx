"use client";

import {
  Check,
  ChevronRight,
  Copy,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Users,
  UserX,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { confirmDialog, showToast } from "@/lib/dialogManager";
import { capitalizeWords } from "@/lib/textFormat";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Avatar, PageHeader } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectConnectedAccounts } from "@/store/quickBooks/quickBooksSlice";
import {
  fetchQBMembers,
  inviteQBMember,
  removeQBMember,
  updateQBMember,
  type QBMemberRole,
} from "@/store/quickBooks/quickBooksApi";
import { Switch } from "@/components/ui/Switch";
import { fetchInboundOverview } from "@/store/inboundEmail/inboundEmailApi";

interface QBMember {
  _id: string;
  invitedEmail: string;
  role: string;
  inviteStatus?: string;
  /** Whether invoices they upload may auto-post (on top of the company setting). */
  autoPostAllowed?: boolean;
  /** The email-forwarding account: its invoices follow the company setting only. */
  isForwardingService?: boolean;
  createdAt?: string;
  userId?: {
    firstName: string;
    lastName: string;
    email: string;
    icon?: string | null;
  } | null;
}

const memberDisplayName = (member: QBMember) =>
  member.userId
    ? capitalizeWords(`${member.userId.firstName} ${member.userId.lastName}`)
    : member.invitedEmail;

const memberInitials = (member: QBMember) => {
  if (member.userId) {
    const initials =
      `${member.userId.firstName?.[0] ?? ""}${member.userId.lastName?.[0] ?? ""}`.toUpperCase();
    if (initials) return initials;
  }
  return member.invitedEmail?.[0]?.toUpperCase() || "?";
};

const formatMemberDate = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

const ROLE_META: Record<string, { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-[#E5F7F5] text-[#177E71]" },
  admin: { label: "Admin", className: "bg-[#EEF4FF] text-[#4A6CF7]" },
  accountant: { label: "Accountant", className: "bg-[#F5F3FF] text-[#7C3AED]" },
  contributor: {
    label: "Contributor",
    className: "bg-background-alt text-text-secondary",
  },
};
const ROLE_FALLBACK = {
  label: "Member",
  className: "bg-background-alt text-text-secondary",
};

// New invites start from these; matches the backend's role defaults
// (Scantrix_API services/team_auto_post.service.js).
const ROLE_DEFAULT_AUTO_POST: Record<QBMemberRole, boolean> = {
  admin: true,
  accountant: true,
  contributor: false,
};

const INVITABLE_ROLES: {
  key: QBMemberRole;
  label: string;
  description: string;
}[] = [
  {
    key: "admin",
    label: "Admin",
    description: "Manages team and reconnects accounting software.",
  },
  {
    key: "accountant",
    label: "Accountant",
    description: "Full access to invoices, vendors & accounts.",
  },
  {
    key: "contributor",
    label: "Contributor",
    description: "Can upload and edit invoices only.",
  },
];

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function TeamMembersContentV2() {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector(
    (state) => state.auth.user?.data?.accessToken,
  );
  const authUser = useAppSelector((state) => state.auth.user?.data?.user);
  const qbConnectionId = useAppSelector(
    (state) => state.quickBooks.qbConnectionId,
  );
  const inboundAliases = useAppSelector((state) => state.inboundEmail.aliases);

  // Loaded once by AppShell into the quickBooks slice — no per-page fetch.
  const connections = useAppSelector(selectConnectedAccounts);
  const router = useRouter();
  const loadingConnections = useAppSelector((state) => !state.quickBooks.connectionsLoaded);
  const [members, setMembers] = useState<QBMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState("");
  const [inviteRole, setInviteRole] = useState<QBMemberRole>("accountant");
  const [inviteAutoPost, setInviteAutoPost] = useState(ROLE_DEFAULT_AUTO_POST.accountant);
  // Members whose auto-post save is in flight — one each, so finishing one
  // doesn't unlock another's switch mid-request.
  const [togglingIds, setTogglingIds] = useState<Set<string>>(() => new Set());

  const [sending, setSending] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  // With exactly one connected company there's nothing to choose, so use it
  // directly. With 2+, only use a match for an id the user actually
  // selected — the top-bar switcher starts blank when multiple companies are
  // connected, and this page shouldn't silently pick one on its own.
  const activeConnection =
    connections.length === 1
      ? connections[0]
      : connections.find((c) => c._id === qbConnectionId);
  const currentRole = activeConnection?.role || "";
  const canInvite = currentRole === "owner" || currentRole === "admin";
  const availableRoles = INVITABLE_ROLES.filter(
    (r) => currentRole === "owner" || r.key !== "admin",
  );

  const canRemoveRole = (memberRole: string) => {
    if (currentRole === "owner") return true;
    if (currentRole === "admin") return memberRole !== "admin";
    return false;
  };

  // Same who-can rule as removing (the backend enforces it too). The self
  // row and the forwarding account are handled where the row is drawn.
  const canEditAutoPost = (member: QBMember) => canRemoveRole(member.role);

  const currentUserEmail = authUser?.email?.toLowerCase();
  const isSelf = (member: QBMember) =>
    !!currentUserEmail &&
    (member.userId?.email || member.invitedEmail || "").toLowerCase() ===
      currentUserEmail;

  // The members endpoint only returns invited teammates, not the connection
  // owner/accountant viewing this page — so without this, a solo owner sees
  // an empty team list despite clearly having access themselves.
  const displayMembers = useMemo(() => {
    if (!currentUserEmail || members.some(isSelf)) return members;
    const self: QBMember = {
      _id: "__self__",
      invitedEmail: authUser?.email || "",
      role: currentRole,
      inviteStatus: "accepted",
      userId: {
        firstName: authUser?.firstName || "",
        lastName: authUser?.lastName || "",
        email: authUser?.email || "",
      },
    };
    return [self, ...members];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, currentUserEmail, currentRole, authUser]);

  // The active company's own inbound-email address, shown as a virtual
  // "team member" row — invoices forwarded there are ingested at the same
  // permission level as a contributor upload. Only shown once forwarding has
  // actually been turned on for this company; no fabricated placeholder row.
  const forwardingAlias = useMemo(
    () =>
      activeConnection
        ? inboundAliases.find(
            (alias) =>
              alias.qbConnectionId === activeConnection._id && alias.active,
          )
        : undefined,
    [inboundAliases, activeConnection],
  );

  const handleCopyForwardingAddress = async () => {
    if (!forwardingAlias) return;
    try {
      await navigator.clipboard.writeText(forwardingAlias.receivingAddress);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      showToast("Couldn't copy the address.", "error");
    }
  };

  // The overview lives in the store, so a visit only fetches it when it isn't
  // loaded yet or the last attempt failed (retried once per visit, as before).
  const inboundLoaded = useAppSelector((state) => state.inboundEmail.loaded);
  const inboundLoading = useAppSelector((state) => state.inboundEmail.loading);
  const inboundError = useAppSelector((state) => state.inboundEmail.error);
  useEffect(() => {
    if (inboundLoading) return;
    if (!inboundLoaded || inboundError) dispatch(fetchInboundOverview());
    // Mount only — re-running on these would retry a failing fetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which company `members` belongs to — a refetch for the same company (e.g.
  // after an invite) keeps the list on screen instead of a skeleton, while a
  // company switch still clears it first.
  const membersForIdRef = useRef<string | null>(null);

  const fetchMembers = useCallback(
    async (qbId: string) => {
      if (membersForIdRef.current !== qbId) {
        membersForIdRef.current = null;
        setMembers([]);
      }
      setMembersLoading(true);
      setMembersError("");
      const result = await dispatch(fetchQBMembers({ qbId }));
      if (fetchQBMembers.fulfilled.match(result)) {
        membersForIdRef.current = qbId;
        setMembers(result.payload?.data?.members ?? []);
      } else {
        const payload = result.payload as { message?: string } | undefined;
        setMembers([]);
        setMembersError(payload?.message || "Failed to load team members");
      }
      setMembersLoading(false);
    },
    [dispatch],
  );

  useEffect(() => {
    if (activeConnection?._id) fetchMembers(activeConnection._id);
    else setMembers([]);
  }, [activeConnection?._id, fetchMembers]);

  // The company's own auto-post toggle (from the connections list AppShell
  // keeps loaded): off, nobody's uploads auto-post, whatever their switch
  // says. null when not known.
  const companyAutoPost = activeConnection?.autoPostEnabled ?? null;

  const handleRemoveMember = async (member: QBMember) => {
    if (!activeConnection) return;
    const confirmed = await confirmDialog({
      title: "Remove team member?",
      message: `${memberDisplayName(member)} will lose access to ${activeConnection.name} immediately. Remove them?`,
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (!confirmed) return;
    setRemovingId(member._id);
    try {
      const result = await dispatch(
        removeQBMember({ qbId: activeConnection._id, memberId: member._id }),
      );
      if (removeQBMember.fulfilled.match(result)) {
        setMembers((prev) => prev.filter((m) => m._id !== member._id));
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Please try again.", "error");
      }
    } finally {
      setRemovingId(null);
    }
  };

  // Backend treats an invite POST to an already-pending email as a resend:
  // it regenerates the token, re-sends the email, and enforces its own
  // 60-second per-email cooldown (plus a 15-min/30-request cap on the whole
  // endpoint) — so this just calls the same thunk again with that member's
  // existing email/role rather than needing a dedicated resend endpoint.
  const handleResendInvite = async (member: QBMember) => {
    if (!accessToken || !activeConnection) return;
    setResendingId(member._id);
    try {
      const result = await dispatch(
        inviteQBMember({
          accessToken,
          qbId: activeConnection._id,
          email: member.invitedEmail,
          role: member.role as QBMemberRole,
        }),
      );
      if (inviteQBMember.fulfilled.match(result)) {
        showToast(`Invite resent to ${member.invitedEmail}.`, "success");
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(
          payload?.message || "Could not resend invite. Please try again.",
          "error",
        );
      }
    } finally {
      setResendingId(null);
    }
  };

  const chooseInviteRole = (role: QBMemberRole) => {
    setInviteRole(role);
    setInviteAutoPost(ROLE_DEFAULT_AUTO_POST[role]);
  };

  const openInviteSheet = () => {
    setInviteEmail("");
    setInviteEmailError("");
    chooseInviteRole(
      availableRoles[availableRoles.length - 1]?.key || "contributor",
    );
    setSheetVisible(true);
  };

  const handleToggleAutoPost = async (member: QBMember, allowed: boolean) => {
    if (!activeConnection) return;
    const name = memberDisplayName(member);
    const confirmed = await confirmDialog(
      allowed
        ? {
            title: `Allow auto-post for ${name}?`,
            message: [
              `Invoices ${name} uploads will be posted to ${activeConnection.name} automatically when they pass every check: an exact vendor match, no missing fields and high confidence. Anything else still goes to review.`,
              ...(companyAutoPost === false
                ? ["", `Auto-post is turned off for ${activeConnection.name} right now, so this applies once it's turned back on.`]
                : []),
            ].join("\n"),
            confirmLabel: "Allow auto-post",
            size: "wide",
          }
        : {
            title: `Turn off auto-post for ${name}?`,
            message: `Invoices ${name} uploads will always wait for review before they're posted. Invoices already posted aren't affected.`,
            confirmLabel: "Turn off",
            tone: "destructive",
            size: "wide",
          },
    );
    if (!confirmed) return;
    const previous = member.autoPostAllowed;
    const setRow = (value: boolean | undefined) =>
      setMembers((prev) => prev.map((m) => (m._id === member._id ? { ...m, autoPostAllowed: value } : m)));
    setTogglingIds((prev) => new Set(prev).add(member._id));
    // Show it straight away; put the earlier value back if the save fails.
    setRow(allowed);
    try {
      const result = await dispatch(
        updateQBMember({ qbId: activeConnection._id, memberId: member._id, autoPostAllowed: allowed }),
      );
      if (updateQBMember.fulfilled.match(result)) {
        // What the server stored is what the row shows.
        const saved = result.payload?.data?.member?.autoPostAllowed;
        if (typeof saved === "boolean") setRow(saved);
        showToast(
          allowed
            ? `Invoices ${memberDisplayName(member)} uploads can now auto-post.`
            : `Invoices ${memberDisplayName(member)} uploads will now wait for review.`,
          "success",
        );
      } else {
        setRow(previous);
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not update auto-post. Please try again.", "error");
      }
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(member._id);
        return next;
      });
    }
  };

  const handleSendInvite = async () => {
    const trimmedEmail = inviteEmail.trim();
    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      setInviteEmailError("Enter a valid email address");
      return;
    }
    if (!accessToken || !activeConnection) return;

    setSending(true);
    try {
      const result = await dispatch(
        inviteQBMember({
          accessToken,
          qbId: activeConnection._id,
          email: trimmedEmail.toLowerCase(),
          role: inviteRole,
          // Only a change from the role default is stored; otherwise the
          // member keeps following the role default.
          ...(inviteAutoPost !== ROLE_DEFAULT_AUTO_POST[inviteRole] && { autoPostAllowed: inviteAutoPost }),
        }),
      );
      if (inviteQBMember.fulfilled.match(result)) {
        const roleLabel = ROLE_META[inviteRole]?.label || inviteRole;
        setSheetVisible(false);
        fetchMembers(activeConnection._id);
        showToast(
          `${trimmedEmail} has been invited as ${roleLabel} on ${activeConnection.name}. They'll receive an email with instructions to join.`,
          "success",
        );
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(
          payload?.message || "Could not send invite. Please try again.",
          "error",
        );
      }
    } finally {
      setSending(false);
    }
  };

  if (loadingConnections) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
        <div className="rounded-lg border border-border bg-surface p-[var(--space-lg)] shadow-sm">
          <EmptyState
            icon={<Users size={28} strokeWidth={1.75} />}
            title="Team"
            description={
              connections.length > 0
                ? "Choose a company from the switcher up top to manage its team."
                : "Connect an accounting company before inviting your team to collaborate on it."
            }
            actionLabel={connections.length > 0 ? undefined : "Connect accounting software"}
            onAction={connections.length > 0 ? undefined : () => router.push("/accounting-software")}
            actionVariant="primary"
          />
        </div>
      </div>
    );
  }

  const activeRoleMeta = ROLE_META[currentRole] || ROLE_FALLBACK;
  const noMembersAtAll = displayMembers.length === 0 && !forwardingAlias;

  return (
    <div className="max-w-6xl p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Team Members"
        subtitle="Manage team contributors, accountants, and invoice parsing inboxes."
        action={
          canInvite ? (
            <Button type="button" onClick={openInviteSheet} size="sm" className="shrink-0">
              <Plus size={16} strokeWidth={2.5} />
              Invite Member
            </Button>
          ) : undefined
        }
      />

      <div className="mt-[var(--space-lg)] grid grid-cols-1 gap-[var(--space-lg)] lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div>
          <p className="mb-[var(--space-sm)] text-caption font-bold uppercase tracking-wide text-text-secondary">
            Members
            {displayMembers.length > 0 ? ` (${displayMembers.length})` : ""}
          </p>
          {membersLoading && members.length === 0 ? (
            <SkeletonListRows count={3} />
          ) : membersError ? (
            <ErrorState
              message={membersError}
              onRetry={() => fetchMembers(activeConnection._id)}
            />
          ) : noMembersAtAll ? (
            <div className="rounded-lg border border-border bg-surface p-[var(--space-lg)] text-body-sm text-text-secondary shadow-sm">
              No team members yet. Invited teammates will show up here.
            </div>
          ) : (
            <div className="flex flex-col gap-[var(--space-sm)]">
              {companyAutoPost === false && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
                  Auto-post is turned off for <strong className="font-semibold text-text-primary">{activeConnection?.name}</strong>,
                  so no invoices auto-post right now. The switches below apply once it&apos;s turned back on in Preferences.
                </div>
              )}
              {displayMembers.map((member) => {
                const meta = ROLE_META[member.role] || ROLE_FALLBACK;
                const self = isSelf(member);
                const pending =
                  !self &&
                  member.inviteStatus &&
                  member.inviteStatus !== "accepted";
                const removable = !self && canRemoveRole(member.role);
                const isRemoving = removingId === member._id;
                const isResending = resendingId === member._id;
                const joinedDate = formatMemberDate(member.createdAt);
                // The owner's own row (added here, not a member) has no setting.
                const hasAutoPostRow = member._id !== "__self__";
                const autoPostOn =
                  member.autoPostAllowed ?? ROLE_DEFAULT_AUTO_POST[member.role as QBMemberRole] ?? false;
                return (
                  <div
                    key={member._id}
                    className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
                  >
                    {/* Who: avatar, name, email, status — and what can be done to them. */}
                    <div className="flex items-center gap-[var(--space-sm)] p-[var(--space-md)]">
                      <Avatar
                        name={memberDisplayName(member)}
                        photoURL={member.userId?.icon}
                        initials={memberInitials(member)}
                        size="lg"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-text-primary">
                          {memberDisplayName(member)}
                          {self && (
                            <span className="font-normal text-text-secondary"> (You)</span>
                          )}
                        </p>
                        {member.userId && (
                          <p className="truncate text-caption text-text-secondary">
                            {member.userId.email}
                          </p>
                        )}
                        {(pending || joinedDate) && (
                          <div className="mt-[2px] flex flex-wrap items-center gap-x-[var(--space-sm)] gap-y-[2px] text-caption text-text-secondary">
                            {pending && (
                              <span className="rounded-pill bg-warning/10 px-[var(--space-xs)] py-[1px] font-semibold text-warning">
                                Invite pending
                              </span>
                            )}
                            {joinedDate && <span>Added {joinedDate}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-[var(--space-xs)]">
                        <span
                          className={`rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                        {pending && canInvite && (
                          <button
                            type="button"
                            onClick={() => handleResendInvite(member)}
                            disabled={isResending}
                            aria-label={`Resend invite to ${member.invitedEmail}`}
                            title="Resend invite"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 lg:h-8 lg:w-8"
                          >
                            <RefreshCw
                              size={16}
                              strokeWidth={2.25}
                              className={isResending ? "animate-spin" : ""}
                            />
                          </button>
                        )}
                        {removable && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member)}
                            disabled={isRemoving}
                            title="Remove member"
                            className="flex h-10 w-10 items-center justify-center rounded-md bg-error/10 text-error disabled:opacity-60 lg:h-8 lg:w-8"
                            aria-label={`Remove ${memberDisplayName(member)}`}
                          >
                            {isRemoving ? (
                              "…"
                            ) : (
                              <UserX size={16} strokeWidth={2} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Their setting, kept apart from who they are. */}
                    {hasAutoPostRow && (
                      <div className="flex items-center justify-between gap-[var(--space-md)] border-t border-border bg-background-soft px-[var(--space-md)] py-[var(--space-sm)]">
                        <div className="min-w-0">
                          <p className="text-body-sm font-semibold text-text-primary">Auto-post invoices</p>
                          <p className="text-caption text-text-secondary">
                            {member.isForwardingService
                              ? "Forwarded invoices follow the company auto-post setting."
                              : autoPostOn
                                ? "Invoices they upload post automatically when every check passes."
                                : "Invoices they upload always wait for review."}
                          </p>
                        </div>
                        {member.isForwardingService ? null : canEditAutoPost(member) ? (
                          <Switch
                            checked={autoPostOn}
                            onChange={(allowed) => handleToggleAutoPost(member, allowed)}
                            disabled={togglingIds.has(member._id)}
                            label={`Auto-post invoices uploaded by ${memberDisplayName(member)}`}
                          />
                        ) : (
                          <span
                            className={`shrink-0 rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold ${
                              autoPostOn ? "bg-success/10 text-success" : "bg-background-alt text-text-secondary"
                            }`}
                          >
                            {autoPostOn ? "On" : "Off"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {forwardingAlias && (
                <div className="flex items-center justify-between gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[var(--space-xs)]">
                      <p className="font-semibold text-text-primary">
                        Email Forwarding
                      </p>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-accent-bg px-[var(--space-xs)] py-[2px] text-tiny font-bold text-accent-text-on-bg">
                        <Mail size={10} strokeWidth={2.5} />
                        INBOX
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyForwardingAddress}
                      aria-label={
                        addressCopied
                          ? "Address copied"
                          : "Copy forwarding address"
                      }
                      className="mt-[2px] flex items-center gap-1 text-caption text-text-secondary hover:text-primary"
                    >
                      <span className="truncate">
                        {forwardingAlias.receivingAddress}
                      </span>
                      {addressCopied ? (
                        <Check
                          size={12}
                          strokeWidth={2.5}
                          className="shrink-0 text-success"
                        />
                      ) : (
                        <Copy
                          size={12}
                          strokeWidth={2.25}
                          className="shrink-0"
                        />
                      )}
                    </button>
                  </div>
                  <span className="shrink-0 rounded-pill bg-background-alt px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold text-text-secondary">
                    Contributor
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="mb-[var(--space-sm)] text-caption font-bold uppercase tracking-wide text-text-secondary">
            Active company
          </p>
          <div className="flex items-center justify-between gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-[var(--space-xs)] font-bold text-text-primary">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                <span className="truncate">{activeConnection.name}</span>
              </p>
              <p className="mt-[2px] truncate text-caption text-text-secondary">
                Realm ID: {activeConnection.realmId}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-pill px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold ${activeRoleMeta.className}`}
            >
              {activeRoleMeta.label}
            </span>
          </div>

          {!canInvite && (
            <>
              <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-text-secondary">
                Team access
              </p>

              <div className="flex gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-alt text-text-secondary">
                  <Lock size={16} strokeWidth={2.25} />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-text-primary">
                    Restricted Member Permissions
                  </p>
                  <p className="mt-[2px] text-body-sm text-text-secondary">
                    Only the owner or an admin of{" "}
                    <strong className="font-semibold text-text-primary">
                      {activeConnection.name}
                    </strong>{" "}
                    can invite new team members. You currently have{" "}
                    {activeRoleMeta.label.toLowerCase()} access.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {sheetVisible && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-end justify-center bg-black/40 sm:items-center"
          onClick={() => !sending && setSheetVisible(false)}
        >
          <div
            className="w-full max-w-md cursor-auto rounded-t-2xl bg-surface p-[var(--space-lg)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--space-md)] flex items-center justify-between">
              <h2 className="text-h3 font-bold text-text-primary">
                Invite Team Member
              </h2>
              <button
                type="button"
                onClick={() => !sending && setSheetVisible(false)}
                aria-label="Close"
                className="-m-2 flex h-10 w-10 items-center justify-center text-text-secondary lg:m-0 lg:h-5 lg:w-5"
              >
                <X size={20} strokeWidth={2.25} />
              </button>
            </div>

            <label className="text-body-sm font-semibold text-text-primary">
              Email address
            </label>
            <input
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                if (inviteEmailError) setInviteEmailError("");
              }}
              placeholder="teammate@company.com"
              disabled={sending}
              className={`mt-[var(--space-xs)] h-12 w-full rounded-md border bg-background-soft px-[var(--space-md)] text-body focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                inviteEmailError ? "border-error" : "border-border"
              }`}
            />
            {inviteEmailError && (
              <p className="mt-[var(--space-xs)] text-caption font-semibold text-error">
                {inviteEmailError}
              </p>
            )}

            <label className="mt-[var(--space-md)] block text-body-sm font-semibold text-text-primary">
              Role on {activeConnection.name}
            </label>
            <div className="mt-[var(--space-xs)] flex flex-col gap-[var(--space-sm)]">
              {availableRoles.map((role) => {
                const selected = inviteRole === role.key;
                return (
                  <button
                    key={role.key}
                    type="button"
                    disabled={sending}
                    onClick={() => chooseInviteRole(role.key)}
                    className={`flex items-center justify-between rounded-lg border-2 px-[var(--space-md)] py-[var(--space-sm)] text-left ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background-soft"
                    }`}
                  >
                    <div>
                      <p
                        className={`font-bold ${selected ? "text-[#177E71]" : "text-text-primary"}`}
                      >
                        {role.label}
                      </p>
                      <p className="text-caption text-text-secondary">
                        {role.description}
                      </p>
                    </div>
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? "border-primary" : "border-border"}`}
                    >
                      {selected && (
                        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-[var(--space-md)] flex items-start justify-between gap-[var(--space-md)] rounded-lg border border-border bg-background-soft px-[var(--space-md)] py-[var(--space-sm)]">
              <div>
                <p className="font-bold text-text-primary">Auto-post their invoices</p>
                <p className="text-caption text-text-secondary">
                  On: invoices they upload are posted automatically when they pass every check. Off: they always wait
                  for review. You can change this later.
                  {companyAutoPost === false && " Auto-post is off for the whole company right now, so this applies once it's turned back on."}
                </p>
              </div>
              <Switch
                checked={inviteAutoPost}
                onChange={setInviteAutoPost}
                disabled={sending}
                label="Auto-post their invoices"
              />
            </div>

            <Button
              onClick={handleSendInvite}
              loading={sending}
              disabled={sending}
              className="mt-[var(--space-lg)] w-full"
            >
              Send Invite
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
