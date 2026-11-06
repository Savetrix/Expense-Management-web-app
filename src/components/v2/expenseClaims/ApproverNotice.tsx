"use client";

import { useEffect, useState } from "react";

import { fetchApproverPreview, type ApproverPreviewDto } from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

import { errorMessage } from "./shared";

/**
 * Who a claim or trip will go to — the person's manager, worked out by the
 * backend — or why it can't be sent yet. `forUserId`: the claimant/driver
 * when that's a team member other than you; null = you (or a claimant
 * outside the team, which goes to your manager). `ready` false while the
 * answer is loading or there's nobody to send it to.
 */
export function useApproverPreview(forUserId: string | null, enabled: boolean) {
  const dispatch = useAppDispatch();
  const qbConnectionId = useAppSelector((s) => s.quickBooks.qbConnectionId);
  const [state, setState] = useState<{ key: string; preview: ApproverPreviewDto | null; error: string } | null>(null);
  // Per company too — the same person can have a different manager (or be
  // the owner) in another one.
  const key = `${qbConnectionId}:${forUserId ?? "self"}`;

  // Forget the answer when the form closes, so reopening it never offers to
  // send on a manager who has changed since (a render-time reset, not an
  // effect, so nothing stale renders in between).
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) setState(null);
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    dispatch(fetchApproverPreview({ forUserId })).then((result) => {
      if (cancelled) return;
      if (fetchApproverPreview.fulfilled.match(result)) setState({ key, preview: result.payload, error: "" });
      else setState({ key, preview: null, error: errorMessage(result.payload, "Couldn't check who approves this.") });
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, forUserId, key, enabled]);

  const current = state?.key === key ? state : null;
  return { loading: enabled && !current, preview: current?.preview ?? null, error: current?.error ?? "", ready: !!current?.preview?.approver };
}

export function ApproverNotice({
  loading,
  preview,
  error,
  providerName,
  noun,
}: {
  loading: boolean;
  preview: ApproverPreviewDto | null;
  error: string;
  providerName: string;
  noun: "claim" | "trip";
}) {
  // role="status": a screen reader hears why Send is unavailable.
  const box = "rounded-md border px-[var(--space-md)] py-[var(--space-sm)] text-body-sm";
  if (loading) return <p role="status" className={`${box} border-border bg-page text-content-secondary`}>Checking who approves this…</p>;
  if (error) return <p role="status" className={`${box} border-status-danger-border bg-status-danger-bg text-status-danger-text`}>{error}</p>;
  if (!preview?.approver) {
    return (
      <p role="status" className={`${box} border-status-warning-border bg-status-warning-bg text-status-warning-text`}>
        {preview?.message ?? `This ${noun} can't be sent yet.`}
      </p>
    );
  }
  if (preview.autoApprove) {
    return (
      <p className={`${box} border-border bg-page text-content-primary`}>
        You&apos;re the owner, so it&apos;s approved and posted to {providerName} as soon as you send it.
      </p>
    );
  }
  return (
    <p className={`${box} border-border bg-page text-content-primary`}>
      <span className="text-content-secondary">Approver: </span>
      <span className="font-semibold">{preview.approver.name}</span>
      <span className="text-content-secondary"> (manager)</span>
    </p>
  );
}
