"use client";

import { Landmark, Link2, Lock, ShieldCheck, Unplug } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { completeBankRelogin, createLinkToken, exchangePublicToken } from "@/store/bankFeeds/bankFeedsApi";
import { useAppDispatch } from "@/store/hooks";

import type { PlaidLinkLauncher, PlaidLinkMetadata } from "./plaid";
import { PlaidLinkLauncher as DefaultLauncher } from "./PlaidLinkLauncher";

interface ConnectBankModalProps {
  open: boolean;
  onClose: () => void;
  /** Plaid Link implementation (see plaid.ts). Defaults to react-plaid-link. */
  Launcher?: PlaidLinkLauncher;
  /** Called after the server has saved the new accounts. */
  onConnected?: (publicToken: string, metadata: PlaidLinkMetadata) => void;
  /** Re-login (Plaid update mode) for the bank login behind this account. */
  reloginAccountId?: string | null;
  reloginLabel?: string;
}

type Step = "intro" | "start" | "waiting" | "saving";

export function ConnectBankModal({ open, onClose, Launcher = DefaultLauncher, onConnected, reloginAccountId, reloginLabel }: ConnectBankModalProps) {
  const dispatch = useAppDispatch();
  const relogin = Boolean(reloginAccountId);
  const [step, setStep] = useState<Step>(relogin ? "start" : "intro");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setStep(relogin ? "start" : "intro");
    setLinkToken(null);
    setError("");
    onClose();
  };

  const openPlaid = async () => {
    setError("");
    setStep("waiting");
    const result = await dispatch(createLinkToken(reloginAccountId ? { accountId: reloginAccountId } : undefined));
    if (createLinkToken.fulfilled.match(result)) {
      setSandbox(result.payload.environment === "sandbox");
      setLinkToken(result.payload.linkToken);
    } else {
      setError(result.payload?.message ?? "Couldn't start Plaid. Please try again.");
      setStep("start");
    }
  };

  const finish = async (publicToken: string, meta: PlaidLinkMetadata) => {
    setStep("saving");
    const result = reloginAccountId
      ? await dispatch(completeBankRelogin(reloginAccountId))
      : await dispatch(
          exchangePublicToken({
            publicToken,
            institution: { id: meta.institutionId, name: meta.institutionName },
            accounts: meta.accounts.map((a) => ({ mask: a.mask })),
          }),
        );
    if (result.meta.requestStatus === "fulfilled") {
      showToast(reloginAccountId ? "Bank reconnected. Syncing now." : `${meta.institutionName ?? "Bank"} connected. Transactions are on their way.`, "success");
      onConnected?.(publicToken, meta);
      close();
    } else {
      const payload = result.payload as { message?: string } | undefined;
      setError(payload?.message ?? "Couldn't save the connection. Please try again.");
      setLinkToken(null);
      setStep("start");
    }
  };

  const footer =
    step === "intro" ? (
      <Button onClick={() => setStep("start")}>Continue</Button>
    ) : step === "start" ? (
      <>
        {!relogin && (
          <Button variant="outline" onClick={() => setStep("intro")}>
            Back
          </Button>
        )}
        <Button onClick={openPlaid}>
          <Link2 size={16} strokeWidth={2.25} />
          Open Plaid Link
        </Button>
      </>
    ) : step === "saving" ? null : (
      <Button variant="outline" onClick={close}>
        Cancel
      </Button>
    );

  return (
    <Modal open={open} onClose={close} title={relogin ? "Sign in to your bank again" : "Connect a bank with Plaid"} footer={footer} widthClassName="max-w-lg">
      {step === "intro" && (
        <div className="flex flex-col gap-[var(--space-md)] text-body-sm text-content-secondary">
          <p>Plaid is the service that securely links your bank to Scantrix so bank activity can be imported and matched to your bills.</p>
          <ul className="flex flex-col gap-[var(--space-sm)]">
            <li className="flex items-start gap-[var(--space-sm)]">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-content-primary" />
              <span>Read-only access. Scantrix can see account activity but can never move money.</span>
            </li>
            <li className="flex items-start gap-[var(--space-sm)]">
              <Lock size={18} className="mt-0.5 shrink-0 text-content-primary" />
              <span>You enter your bank credentials inside Plaid&apos;s secure window. Scantrix never sees them.</span>
            </li>
            <li className="flex items-start gap-[var(--space-sm)]">
              <Unplug size={18} className="mt-0.5 shrink-0 text-content-primary" />
              <span>You can disconnect at any time.</span>
            </li>
          </ul>
        </div>
      )}

      {step === "start" && (
        <div className="flex flex-col items-center gap-[var(--space-md)] py-[var(--space-md)] text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-alt text-content-secondary">
            <Landmark size={26} strokeWidth={1.75} />
          </span>
          <p className="text-body-sm text-content-secondary">
            {relogin
              ? `${reloginLabel ?? "This bank"} needs you to sign in again before transactions can keep coming. Plaid opens in a secure window; it usually takes a few seconds.`
              : "Next, Plaid Link opens in a secure window where you choose your bank and sign in."}
          </p>
          {error && <p className="text-body-sm font-semibold text-status-danger-text">{error}</p>}
        </div>
      )}

      {step === "waiting" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div className="flex items-center gap-[var(--space-sm)] text-body font-bold text-content-primary">
            <Spinner size="sm" />
            Waiting for Plaid
          </div>
          <p className="text-body-sm text-content-secondary">Finish in Plaid&apos;s window. This dialog closes by itself when you are done.</p>
          {sandbox && (
            <p className="rounded-md border border-status-info-border bg-status-info-bg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-status-info-text">
              Test mode: no real bank is used. Pick any bank and sign in with <strong>user_good</strong> / <strong>pass_good</strong>, or <strong>user_transactions_dynamic</strong> with any password for a busier account.
            </p>
          )}
          {linkToken && <Launcher linkToken={linkToken} onSuccess={finish} onExit={() => { setLinkToken(null); setStep("start"); }} />}
        </div>
      )}

      {step === "saving" && (
        <div className="flex items-center gap-[var(--space-sm)] py-[var(--space-md)] text-body font-bold text-content-primary">
          <Spinner size="sm" />
          {relogin ? "Reconnecting and syncing…" : "Saving your accounts…"}
        </div>
      )}
    </Modal>
  );
}
