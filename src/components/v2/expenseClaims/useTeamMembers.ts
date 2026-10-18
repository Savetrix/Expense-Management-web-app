"use client";

import { useEffect, useMemo, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQBMembers } from "@/store/quickBooks/quickBooksApi";

/** A teammate on the active company, as the pickers on these pages need it. */
export interface TeamPerson {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface RawMember {
  _id: string;
  invitedEmail?: string;
  role?: string;
  inviteStatus?: string;
  userId?: { firstName?: string; lastName?: string; email?: string } | null;
}

const titleCase = (value: string) => value.replace(/\b\w/g, (c) => c.toUpperCase());
const roleLabel = (role?: string) => (role ? titleCase(role.replace(/_/g, " ")) : "Member");

function toPerson(m: RawMember): TeamPerson {
  const fullName = m.userId ? `${m.userId.firstName ?? ""} ${m.userId.lastName ?? ""}`.trim() : "";
  const email = m.userId?.email || m.invitedEmail || "";
  return { id: m._id, name: fullName ? titleCase(fullName) : email, email, role: roleLabel(m.role) };
}

/**
 * Team members of the company picked in the header — the same
 * GET /qb-connections/:id/members call the Team page makes (`fetchQBMembers`),
 * plus the signed-in user, whom that endpoint leaves out.
 */
export function useTeamMembers() {
  const dispatch = useAppDispatch();
  const connections = useAppSelector((state) => state.quickBooks.connections);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const authUser = useAppSelector((state) => state.auth.user?.data?.user);

  const activeConnection = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const activeId = activeConnection?._id ?? "";
  const currentRole = activeConnection?.role ?? "";

  const [raw, setRaw] = useState<{ forId: string; members: RawMember[]; error: string }>({ forId: "", members: [], error: "" });

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    dispatch(fetchQBMembers({ qbId: activeId })).then((result) => {
      if (cancelled) return;
      if (fetchQBMembers.fulfilled.match(result)) {
        setRaw({ forId: activeId, members: result.payload?.data?.members ?? [], error: "" });
      } else {
        const payload = result.payload as { message?: string } | undefined;
        setRaw({ forId: activeId, members: [], error: payload?.message || "Couldn't load your team members." });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, dispatch]);

  const members = useMemo<TeamPerson[]>(() => {
    const list = raw.forId === activeId ? raw.members.filter((m) => m.inviteStatus !== "revoked").map(toPerson) : [];
    const selfEmail = authUser?.email?.toLowerCase();
    if (!selfEmail || list.some((m) => m.email.toLowerCase() === selfEmail)) return list;
    const selfName = `${authUser?.firstName ?? ""} ${authUser?.lastName ?? ""}`.trim();
    return [{ id: "__self__", name: selfName ? titleCase(selfName) : authUser?.email ?? "You", email: authUser?.email ?? "", role: roleLabel(currentRole) }, ...list];
  }, [raw, activeId, authUser, currentRole]);

  return { members, loading: !!activeId && raw.forId !== activeId, error: raw.forId === activeId ? raw.error : "", hasCompany: !!activeId };
}
