"use client";

import { useEffect, useMemo, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQBMembers } from "@/store/quickBooks/quickBooksApi";

import type { CompanyRole } from "./shared";

/** Someone on the active company, as the claimant/driver pickers need them. */
export interface TeamPerson {
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface RawUser {
  _id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface RawMember {
  role?: string;
  inviteStatus?: string;
  isForwardingService?: boolean;
  userId?: RawUser | null;
}

const titleCase = (value: string) => value.replace(/\b\w/g, (c) => c.toUpperCase());
const roleLabel = (role?: string) => (role ? titleCase(role.replace(/_/g, " ")) : "Member");

function toPerson(user: RawUser, role?: string): TeamPerson | null {
  if (!user._id) return null;
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  const email = user.email ?? "";
  return { userId: user._id, name: fullName ? titleCase(fullName) : email, email, role: roleLabel(role) };
}

/**
 * The owner and accepted members of the company picked in the header — the
 * same GET /qb-connections/:id/members call the Team page makes. Pending
 * invites have no account yet and the email-forwarding service account isn't
 * a person, so neither is listed. Also returns the signed-in user's id and
 * role on this company.
 */
export function useTeamMembers() {
  const dispatch = useAppDispatch();
  const connections = useAppSelector((state) => state.quickBooks.connections);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const selfId: string = useAppSelector((state) => state.auth.user?.data?.user?._id) ?? "";

  const activeConnection = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const activeId = activeConnection?._id ?? "";
  const role = (activeConnection?.role ?? "") as CompanyRole;

  const [raw, setRaw] = useState<{ forId: string; owner: RawUser | null; members: RawMember[]; error: string }>({
    forId: "",
    owner: null,
    members: [],
    error: "",
  });

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    dispatch(fetchQBMembers({ qbId: activeId })).then((result) => {
      if (cancelled) return;
      if (fetchQBMembers.fulfilled.match(result)) {
        const data = result.payload?.data;
        setRaw({ forId: activeId, owner: data?.owner?.userId ?? null, members: data?.members ?? [], error: "" });
      } else {
        const payload = result.payload as { message?: string } | string | undefined;
        const message = typeof payload === "string" ? payload : payload?.message;
        setRaw({ forId: activeId, owner: null, members: [], error: message || "Couldn't load your team members." });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, dispatch]);

  const members = useMemo<TeamPerson[]>(() => {
    if (raw.forId !== activeId) return [];
    const owner = raw.owner ? toPerson(raw.owner, "owner") : null;
    const accepted = raw.members
      .filter((m) => m.inviteStatus === "accepted" && !m.isForwardingService && m.userId)
      .map((m) => toPerson(m.userId as RawUser, m.role))
      .filter((p): p is TeamPerson => !!p);
    return owner ? [owner, ...accepted] : accepted;
  }, [raw, activeId]);

  return {
    members,
    loading: !!activeId && raw.forId !== activeId,
    error: raw.forId === activeId ? raw.error : "",
    hasCompany: !!activeId,
    activeId,
    role,
    selfId,
  };
}
