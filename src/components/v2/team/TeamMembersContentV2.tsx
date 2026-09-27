"use client";

import Link from "next/link";
import {
  Check,
  ChevronRight,
  Copy,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  UserX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { confirmDialog, showToast } from "@/lib/dialogManager";
import { capitalizeWords } from "@/lib/textFormat";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Avatar, PageHeader } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchQBMembers,
  getMyQBConnections,
  inviteQBMember,
  removeQBMember,
  type QBMemberRole,
} from "@/store/quickBooks/quickBooksApi";
import { fetchInboundOverview } from "@/store/inboundEmail/inboundEmailApi";

interface QBConnection {
  _id: string;
  name: string;
  realmId: string;
  role: string;
  createdAt: string;
}

interface QBMember {
  _id: string;
  invitedEmail: string;
  role: string;
  inviteStatus?: string;
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

const INVITABLE_ROLES: {
  key: QBMemberRole;
  label: string;
  description: string;
}[] = [
  {
    key: "admin",
    label: "Admin",
    description: "Manages team and reconnects QuickBooks.",
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

  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connections, setConnections] = useState<QBConnection[]>([]);
  const [members, setMembers] = useState<QBMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState("");
  const [inviteRole, setInviteRole] = useState<QBMemberRole>("accountant");
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

  const fetchConnections = useCallback(async () => {
    if (!accessToken) {
      setLoadingConnections(false);
      return;
    }
    setLoadingConnections(true);
    const result = await dispatch(getMyQBConnections({ accessToken }));
    if (getMyQBConnections.fulfilled.match(result)) {
      setConnections(result.payload?.data?.connections ?? []);
    } else {
      setConnections([]);
    }
    setLoadingConnections(false);
  }, [accessToken, dispatch]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    dispatch(fetchInboundOverview());
  }, [dispatch]);

  const fetchMembers = useCallback(
    async (qbId: string) => {
      setMembersLoading(true);
      setMembersError("");
      const result = await dispatch(fetchQBMembers({ qbId }));
      if (fetchQBMembers.fulfilled.match(result)) {
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

  const openInviteSheet = () => {
    setInviteEmail("");
    setInviteEmailError("");
    setInviteRole(
      availableRoles[availableRoles.length - 1]?.key || "contributor",
    );
    setSheetVisible(true);
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
        <div className="flex flex-col items-center rounded-lg border border-border bg-surface p-[var(--space-xl)] text-center shadow-sm">
          <p className="font-bold text-text-primary">
            {connections.length > 0
              ? "Select a company"
              : "No company connected"}
          </p>
          <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
            {connections.length > 0
              ? "Choose a company from the switcher up top to manage its team."
              : "Connect a QuickBooks company before inviting your team to collaborate on it."}
          </p>
          {connections.length === 0 && (
            <Link href="/quickbooks">
              <Button className="mt-[var(--space-md)]">
                Connect QuickBooks
              </Button>
            </Link>
          )}
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
          {membersLoading ? (
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
                return (
                  <div
                    key={member._id}
                    className="flex items-center justify-between gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-[var(--space-sm)]">
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
                            <span className="text-text-secondary"> (You)</span>
                          )}
                        </p>
                        {member.userId && (
                          <p className="truncate text-caption text-text-secondary">
                            {member.userId.email}
                          </p>
                        )}
                        {pending && (
                          <p className="text-caption font-semibold text-warning">
                            Invite pending
                          </p>
                        )}
                        {joinedDate && (
                          <p className="truncate text-caption text-text-secondary">
                            Added {joinedDate}
                          </p>
                        )}
                      </div>
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
                          className="flex h-10 shrink-0 items-center gap-1 rounded-md px-[var(--space-sm)] text-caption font-bold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 lg:h-8"
                        >
                          <RefreshCw
                            size={14}
                            strokeWidth={2.25}
                            className={isResending ? "animate-spin" : ""}
                          />
                          Resend
                        </button>
                      )}
                      {removable && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member)}
                          disabled={isRemoving}
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
                    onClick={() => setInviteRole(role.key)}
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
