"use client";

import { Landmark, Link2, Lock, ShieldCheck, Unplug } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import type { PlaidLinkLauncher, PlaidLinkMetadata } from "./plaid";

interface ConnectBankModalProps {
  open: boolean;
  onClose: () => void;
  /** Real Plaid Link implementation (see plaid.ts). Until it exists the flow stops at "Waiting for Plaid". */
  Launcher?: PlaidLinkLauncher;
  /** Called with the accounts the backend returns after exchanging the public token. */
  onConnected?: (publicToken: string, metadata: PlaidLinkMetadata) => void;
}

type Step = "intro" | "start" | "waiting";

export function ConnectBankModal({ open, onClose, Launcher, onConnected }: ConnectBankModalProps) {
  const [step, setStep] = useState<Step>("intro");
  // The backend will fill this from POST /plaid/link-token.
  const [linkToken] = useState<string | null>(null);

  const close = () => {
    setStep("intro");
    onClose();
  };

  const footer =
    step === "intro" ? (
      <Button onClick={() => setStep("start")}>Continue</Button>
    ) : step === "start" ? (
      <>
        <Button variant="outline" onClick={() => setStep("intro")}>
          Back
        </Button>
        <Button
          onClick={() => {
            notifyBackendPending("Open Plaid Link");
            setStep("waiting");
          }}
        >
          <Link2 size={16} strokeWidth={2.25} />
          {beLabel("Open Plaid Link")}
        </Button>
      </>
    ) : (
      <Button variant="outline" onClick={close}>
        Cancel
      </Button>
    );

  return (
    <Modal open={open} onClose={close} title="Connect a bank with Plaid" footer={footer} widthClassName="max-w-lg">
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
            Next, Plaid Link opens in a secure window where you choose your bank and sign in.
          </p>
        </div>
      )}

      {step === "waiting" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <div className="flex items-center gap-[var(--space-sm)] text-body font-bold text-content-primary">
            <Spinner size="sm" />
            Waiting for Plaid
          </div>
          <ol className="list-decimal space-y-[var(--space-xs)] pl-5 text-body-sm text-content-secondary">
            <li>The backend creates a Plaid link token.</li>
            <li>Plaid Link opens so you can pick your bank and sign in.</li>
            <li>On success, the backend exchanges the public token with Plaid and returns your accounts.</li>
          </ol>
          <p className="rounded-md border border-status-info-border bg-status-info-bg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-status-info-text">
            Nothing is connected yet. This step is waiting on the backend, so no bank accounts are added.
          </p>
          {Launcher && (
            <Launcher
              linkToken={linkToken}
              onSuccess={(token, meta) => {
                onConnected?.(token, meta);
                close();
              }}
              onExit={() => setStep("start")}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
