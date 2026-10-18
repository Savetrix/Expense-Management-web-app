"use client";

import { Check, FileText, Image as ImageIcon, MessageCircle, Phone, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { BetaBadge } from "@/components/ui/BetaBadge";
import { Button } from "@/components/ui/Button";
import { Modal, ModalDefinitionRow, SelectDropdown, TextInput } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

// Front-end-only flow: no WhatsApp capture backend exists yet. Every step that
// needs one is a (BE) action that still advances local state so the whole
// flow can be clicked through.

type Step = "intro" | "phone" | "code" | "connected";

const COUNTRY_CODES = [
  { code: "+1", label: "+1 (US/CA)" },
  { code: "+44", label: "+44 (UK)" },
  { code: "+61", label: "+61 (AU)" },
  { code: "+64", label: "+64 (NZ)" },
  { code: "+91", label: "+91 (IN)" },
  { code: "+353", label: "+353 (IE)" },
  { code: "+27", label: "+27 (ZA)" },
];

/** Shown until the backend provides the real Scantrix WhatsApp number. */
const SCANTRIX_WHATSAPP_PLACEHOLDER = "(provided by backend)";

interface WhatsAppCaptureModalProps {
  open: boolean;
  onClose: () => void;
  /** Lets the page reflect the connected state on its row. */
  onConnectedChange?: (connected: boolean) => void;
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ["intro", "phone", "code", "connected"];
  const index = order.indexOf(step);
  return (
    <div className="mb-[var(--space-md)] flex items-center gap-[var(--space-xs)]" aria-hidden>
      {order.map((s, i) => (
        <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-accent" : "bg-border"}`} />
      ))}
    </div>
  );
}

function HowItWorksItem({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-[var(--space-sm)]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-bg text-caption font-bold text-accent-text-on-bg">
        {number}
      </span>
      <div className="min-w-0 flex-1 text-caption text-content-secondary">{children}</div>
    </li>
  );
}

export function WhatsAppCaptureModal({ open, onClose, onConnectedChange }: WhatsAppCaptureModalProps) {
  const provider = useActiveProvider();
  const [step, setStep] = useState<Step>("intro");
  const [countryCode, setCountryCode] = useState(COUNTRY_CODES[0].code);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [connectedNumber, setConnectedNumber] = useState<string | null>(null);

  const fullNumber = `${countryCode} ${phone.trim()}`;

  const handleSendCode = () => {
    const digits = phone.replace(/[\s()-]/g, "");
    if (!/^\d{6,14}$/.test(digits)) {
      setPhoneError("Enter a valid mobile number (digits only).");
      return;
    }
    notifyBackendPending("Send verification code");
    setCode("");
    setCodeError("");
    setStep("code");
  };

  const handleVerify = () => {
    if (!/^\d{6}$/.test(code)) {
      setCodeError("Enter the 6-digit code.");
      return;
    }
    notifyBackendPending("Verify");
    setConnectedNumber(fullNumber);
    setStep("connected");
    onConnectedChange?.(true);
  };

  const handleDisconnect = async () => {
    const confirmed = await confirmDialog({
      title: "Disconnect WhatsApp?",
      message: "Files you send from this number will no longer be captured by Scantrix.",
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (!confirmed) return;
    notifyBackendPending("Disconnect WhatsApp");
    setConnectedNumber(null);
    setPhone("");
    setCode("");
    setStep("intro");
    onConnectedChange?.(false);
  };

  const footer =
    step === "intro" ? (
      <Button type="button" size="sm" onClick={() => setStep("phone")}>
        Get started
      </Button>
    ) : step === "phone" ? (
      <>
        <Button type="button" variant="outline" size="sm" onClick={() => setStep("intro")}>
          Back
        </Button>
        <Button type="button" size="sm" onClick={handleSendCode}>
          {beLabel("Send verification code")}
        </Button>
      </>
    ) : step === "code" ? (
      <>
        <Button type="button" variant="outline" size="sm" onClick={() => setStep("phone")}>
          Change number
        </Button>
        <Button type="button" size="sm" onClick={handleVerify}>
          {beLabel("Verify")}
        </Button>
      </>
    ) : (
      <>
        <Button type="button" variant="danger" size="sm" onClick={() => void handleDisconnect()}>
          {beLabel("Disconnect")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Done
        </Button>
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClassName="max-w-lg"
      ariaLabel="WhatsApp capture"
      footer={footer}
      title={
        <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-alt">
            <MessageCircle size={18} strokeWidth={2} className="text-content-secondary" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">Capture</span>
            <span className="flex min-w-0 items-center gap-[var(--space-xs)]">
              <span className="truncate text-h3 font-bold text-content-primary">WhatsApp</span>
              <BetaBadge />
            </span>
          </span>
        </span>
      }
    >
      <StepDots step={step} />

      {step === "intro" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-secondary">
            Send photos or PDFs of receipts and bills to Scantrix on WhatsApp. They are read, coded and queued for
            review just like an upload, ready to post to {provider.name}.
          </p>
          <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
            <div className="flex gap-[var(--space-sm)] rounded-md border border-border bg-surface-alt p-[var(--space-sm)]">
              <ImageIcon size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-content-secondary" />
              <p className="text-caption text-content-secondary">Snap a receipt or forward a bill PDF from any chat.</p>
            </div>
            <div className="flex gap-[var(--space-sm)] rounded-md border border-border bg-surface-alt p-[var(--space-sm)]">
              <FileText size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-content-secondary" />
              <p className="text-caption text-content-secondary">
                Add a note such as &ldquo;team lunch&rdquo; or &ldquo;expense for Sam&rdquo; to give context.
              </p>
            </div>
          </div>
          <p className="flex gap-[var(--space-xs)] text-caption text-content-muted">
            <ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
            A personal WhatsApp account is required — WhatsApp Business accounts are not supported.
          </p>
        </div>
      )}

      {step === "phone" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-secondary">
            Enter the mobile number you&apos;ll send files from. We&apos;ll send a 6-digit code to it on WhatsApp.
          </p>
          <div className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-[var(--space-sm)]">
            <SelectDropdown
              label="Country"
              name="wa-country"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </SelectDropdown>
            <TextInput
              label="Mobile number"
              name="wa-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="555 123 4567"
              value={phone}
              error={phoneError}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError("");
              }}
            />
          </div>
        </div>
      )}

      {step === "code" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="text-body-sm text-content-secondary">
            Enter the 6-digit code sent to <span className="font-semibold text-content-primary">{fullNumber}</span>.
          </p>
          <TextInput
            label="Verification code"
            name="wa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            error={codeError}
            className="font-mono tracking-[0.3em]"
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              if (codeError) setCodeError("");
            }}
          />
          <button
            type="button"
            onClick={() => notifyBackendPending("Resend code")}
            className="self-start text-caption font-bold text-accent hover:underline"
          >
            {beLabel("Resend code")}
          </button>
        </div>
      )}

      {step === "connected" && (
        <div className="flex flex-col gap-[var(--space-md)]">
          <p className="flex items-center gap-[var(--space-xs)] text-caption font-semibold text-status-success-text">
            <Check size={14} strokeWidth={2.5} />
            WhatsApp connected
          </p>

          <div className="rounded-md border border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-xs)]">
            <ModalDefinitionRow label="Your number" icon={<Phone size={14} strokeWidth={2} />}>
              <span className="truncate">{connectedNumber}</span>
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Send files to" icon={<MessageCircle size={14} strokeWidth={2} />}>
              <span className="truncate text-caption text-content-secondary">{SCANTRIX_WHATSAPP_PLACEHOLDER}</span>
            </ModalDefinitionRow>
          </div>

          <div>
            <p className="mb-[var(--space-sm)] text-tiny font-bold uppercase tracking-[0.08em] text-content-secondary">
              How a submission works
            </p>
            <ol className="flex flex-col gap-[var(--space-sm)]">
              <HowItWorksItem number={1}>
                Send one or more photos or PDFs to the Scantrix number, optionally with a note.
              </HowItWorksItem>
              <HowItWorksItem number={2}>
                Scantrix replies with the {provider.companyNoun} it thinks the document belongs to.
              </HowItWorksItem>
              <HowItWorksItem number={3}>
                Reply <span className="font-semibold text-content-primary">Submit</span> to send it for processing, or{" "}
                <span className="font-semibold text-content-primary">Make changes</span> to:
                <ul className="mt-[var(--space-xs)] list-disc pl-[var(--space-md)]">
                  <li>change the {provider.companyNoun}</li>
                  <li>add a context note</li>
                  <li>merge several files into one PDF</li>
                </ul>
              </HowItWorksItem>
            </ol>
          </div>

          <p className="flex gap-[var(--space-xs)] text-caption text-content-muted">
            <ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
            Use a personal WhatsApp account — WhatsApp Business accounts can&apos;t be connected.
          </p>
        </div>
      )}
    </Modal>
  );
}
