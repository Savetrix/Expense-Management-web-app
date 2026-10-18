"use client";

import { AlertTriangle, CheckCircle2, Clock, Landmark, Send, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ModalDefinitionRow, ProgressBar, TextInput } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import type { ApprovalRules, BankDetails, Bill, PayVendor, PayingAccount, PaymentRun, TeamMember } from "./types";
import { approverNames, delay, maskNumber, localId, money, needsApproval, shortDate, sumAmounts, todayIso } from "./shared";

type Step = "review" | "bank" | "approval" | "payFrom" | "success";

const STEP_LABELS: Record<Exclude<Step, "success">, string> = {
  review: "Review payments",
  bank: "Bank details",
  approval: "Approval check",
  payFrom: "Pay from",
};

interface PaymentRunWizardProps {
  bills: Bill[];
  vendors: PayVendor[];
  rules: ApprovalRules;
  team: TeamMember[];
  accounts: PayingAccount[];
  onClose: () => void;
  onSendForApproval: (billIds: string[]) => void;
  onCreateRun: (run: PaymentRun) => void;
  onUpdateVendors: (vendors: PayVendor[]) => void;
}

type Result = { kind: "paid" | "auth" | "approval"; total: number; count: number };

export function PaymentRunWizard({ bills, vendors, rules, team, accounts, onClose, onSendForApproval, onCreateRun, onUpdateVendors }: PaymentRunWizardProps) {
  const provider = useActiveProvider();
  const [step, setStep] = useState<Step>("review");
  const [activeIds, setActiveIds] = useState<string[]>(() => bills.map((b) => b.id));
  const [references, setReferences] = useState<Record<string, string>>(() => {
    const refs: Record<string, string> = {};
    bills.forEach((b) => {
      refs[b.vendorId] = refs[b.vendorId] ? refs[b.vendorId] : b.reference;
    });
    // Several bills to one vendor: lead with the first ref and count the rest.
    Object.keys(refs).forEach((vendorId) => {
      const count = bills.filter((b) => b.vendorId === vendorId).length;
      if (count > 1) refs[vendorId] = `${refs[vendorId]} +${count - 1}`;
    });
    return refs;
  });
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [bankChoice, setBankChoice] = useState<Record<string, "keep" | "new">>({});
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState<"approval" | "pay" | "auth" | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const activeBills = useMemo(() => bills.filter((b) => activeIds.includes(b.id)), [bills, activeIds]);
  const groups = useMemo(() => {
    const map = new Map<string, Bill[]>();
    activeBills.forEach((b) => map.set(b.vendorId, [...(map.get(b.vendorId) ?? []), b]));
    return [...map.entries()].map(([vendorId, rows]) => ({
      vendor: vendors.find((v) => v.id === vendorId)!,
      bills: rows,
      total: sumAmounts(rows),
    }));
  }, [activeBills, vendors]);
  const total = sumAmounts(activeBills);
  const flagged = activeBills.filter((b) => needsApproval(b, rules));

  const steps: Exclude<Step, "success">[] = flagged.length > 0 ? ["review", "bank", "approval", "payFrom"] : ["review", "bank", "payFrom"];
  const stepIndex = step === "success" ? steps.length : steps.indexOf(step as Exclude<Step, "success">) + 1;

  const detailsFor = (vendor: PayVendor): BankDetails =>
    vendor.changedBank && bankChoice[vendor.id] === "new" ? vendor.changedBank : vendor.bank;

  const needsConfirm = (vendor: PayVendor) => vendor.firstPayment || (vendor.changedBank && bankChoice[vendor.id] === "new");
  const bankBlocked = groups.some(
    ({ vendor }) => (vendor.changedBank && !bankChoice[vendor.id]) || (needsConfirm(vendor) && !confirmed[vendor.id]),
  );
  const referencesMissing = groups.some(({ vendor }) => !references[vendor.id]?.trim());

  const goNext = () => {
    const i = steps.indexOf(step as Exclude<Step, "success">);
    if (i >= 0 && i < steps.length - 1) setStep(steps[i + 1]);
  };
  const goBack = () => {
    const i = steps.indexOf(step as Exclude<Step, "success">);
    if (i > 0) setStep(steps[i - 1]);
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  const handleSendForApproval = async () => {
    setBusy("approval");
    await delay();
    const ids = flagged.map((b) => b.id);
    onSendForApproval(ids);
    notifyBackendPending("Send for approval");
    setBusy(null);
    const remaining = activeIds.filter((id) => !ids.includes(id));
    setActiveIds(remaining);
    if (remaining.length === 0) {
      setResult({ kind: "approval", total: sumAmounts(flagged), count: flagged.length });
      setStep("success");
    } else {
      showToast(`${ids.length} bill${ids.length === 1 ? "" : "s"} sent for approval. Continue paying the rest.`, "success");
      setStep("payFrom");
    }
  };

  const handlePay = async (mode: "pay" | "auth") => {
    if (!accountId) return;
    setBusy(mode);
    await delay(700);
    const run: PaymentRun = {
      id: localId("run"),
      date: todayIso(),
      bills: groups.flatMap(({ vendor, bills: rows }) =>
        rows.map((b) => ({ billId: b.id, vendorName: vendor.name, reference: b.reference, amount: b.amount })),
      ),
      total,
      paidFromId: accountId,
      status: mode === "pay" ? "processing" : "waiting_authorisation",
    };
    onCreateRun(run);
    // Confirmed details become the vendor's known-good details for next time.
    onUpdateVendors(groups.map(({ vendor }) => ({ ...vendor, bank: detailsFor(vendor), firstPayment: false, changedBank: undefined })));
    notifyBackendPending(mode === "pay" ? "Pay" : "Request authorisation from bank login holder");
    setBusy(null);
    setResult({ kind: mode === "pay" ? "paid" : "auth", total, count: activeBills.length });
    setStep("success");
  };

  const account = accounts.find((a) => a.id === accountId);

  let footer: React.ReactNode;
  if (step === "success") {
    footer = (
      <Button size="sm" onClick={onClose}>
        Done
      </Button>
    );
  } else if (step === "approval") {
    footer = (
      <div className="flex w-full flex-wrap items-center justify-between gap-[var(--space-sm)]">
        <Button variant="outline" size="sm" onClick={goBack} disabled={!!busy}>
          Back
        </Button>
        <Button size="sm" onClick={handleSendForApproval} loading={busy === "approval"} disabled={!!busy}>
          <Send size={16} strokeWidth={2.25} />
          {beLabel("Send for approval")}
        </Button>
      </div>
    );
  } else if (step === "payFrom") {
    footer = (
      <div className="flex w-full flex-col-reverse gap-[var(--space-sm)] sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" size="sm" onClick={goBack} disabled={!!busy}>
          Back
        </Button>
        <div className="flex flex-col gap-[var(--space-sm)] sm:flex-row">
          <Button variant="outline" size="sm" onClick={() => handlePay("auth")} loading={busy === "auth"} disabled={!!busy || !accountId}>
            {beLabel("Request authorisation from bank login holder")}
          </Button>
          <Button size="sm" onClick={() => handlePay("pay")} loading={busy === "pay"} disabled={!!busy || !accountId}>
            {beLabel(`Pay ${money(total)}`)}
          </Button>
        </div>
      </div>
    );
  } else {
    footer = (
      <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
        <Button variant="outline" size="sm" onClick={step === "review" ? close : goBack}>
          {step === "review" ? "Cancel" : "Back"}
        </Button>
        <Button size="sm" onClick={goNext} disabled={(step === "review" && referencesMissing) || (step === "bank" && bankBlocked)}>
          Next
        </Button>
      </div>
    );
  }

  return (
    <Modal open onClose={close} title="Payment run" widthClassName="max-w-2xl" footer={footer}>
      <div className="flex flex-col gap-[var(--space-md)]">
        {step !== "success" && (
          <div>
            <p className="text-caption font-semibold text-content-secondary">
              Step {stepIndex} of {steps.length} · {STEP_LABELS[step]}
            </p>
            <div className="mt-[var(--space-xs)]">
              <ProgressBar percent={(stepIndex / steps.length) * 100} label="Payment run progress" />
            </div>
          </div>
        )}

        {step === "review" && (
          <>
            <p className="text-body-sm text-content-secondary">
              Bills to the same vendor are combined into one payment. Set the reference the vendor will see on their statement.
            </p>
            {groups.map(({ vendor, bills: rows, total: vendorTotal }) => (
              <div key={vendor.id} className="rounded-md border border-border bg-page p-[var(--space-md)]">
                <div className="flex items-start justify-between gap-[var(--space-sm)]">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-bold text-content-primary">{vendor.name}</p>
                    <p className="text-caption text-content-secondary">
                      {rows.length} bill{rows.length === 1 ? "" : "s"} · {rows.map((b) => b.reference).join(", ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(vendorTotal)}</span>
                </div>
                <div className="mt-[var(--space-sm)]">
                  <TextInput
                    label="Payment reference"
                    value={references[vendor.id] ?? ""}
                    maxLength={18}
                    onChange={(e) => setReferences((r) => ({ ...r, [vendor.id]: e.target.value }))}
                    error={!references[vendor.id]?.trim() ? "Add a reference" : undefined}
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)] text-body font-bold text-content-primary">
              <span>
                {groups.length} payment{groups.length === 1 ? "" : "s"}
              </span>
              <span>{money(total)}</span>
            </div>
          </>
        )}

        {step === "bank" && (
          <>
            <p className="text-body-sm text-content-secondary">
              Check where each payment is going. New vendors and changed details need a quick confirmation before money moves.
            </p>
            {groups.map(({ vendor, total: vendorTotal }) => {
              const details = detailsFor(vendor);
              const choice = bankChoice[vendor.id];
              return (
                <div key={vendor.id} className="rounded-md border border-border bg-page p-[var(--space-md)]">
                  <div className="flex flex-wrap items-center justify-between gap-[var(--space-sm)]">
                    <p className="text-body-sm font-bold text-content-primary">{vendor.name}</p>
                    <span className="flex items-center gap-[var(--space-xs)]">
                      {vendor.firstPayment && <Badge variant="warning">First payment</Badge>}
                      <span className="text-body-sm font-bold text-content-primary">{money(vendorTotal)}</span>
                    </span>
                  </div>

                  {vendor.changedBank && (
                    <div className="mt-[var(--space-sm)] rounded-md border border-status-warning-border bg-status-warning-bg p-[var(--space-sm)] text-body-sm text-status-warning-text">
                      <p className="flex items-center gap-[var(--space-xs)] font-semibold">
                        <AlertTriangle size={16} strokeWidth={2.25} />
                        Bank details changed since last payment
                      </p>
                      <p className="mt-[var(--space-xs)]">
                        The latest invoice shows {maskNumber(vendor.changedBank.accountNumber)} instead of {maskNumber(vendor.bank.accountNumber)}.
                        Changed bank details are a common fraud signal — check with the vendor by phone before using new details.
                      </p>
                      <div className="mt-[var(--space-sm)] flex flex-wrap gap-[var(--space-sm)]">
                        <Button
                          size="sm"
                          variant={choice === "keep" ? "primary" : "outline"}
                          onClick={() => setBankChoice((c) => ({ ...c, [vendor.id]: "keep" }))}
                        >
                          Keep existing
                        </Button>
                        <Button
                          size="sm"
                          variant={choice === "new" ? "primary" : "outline"}
                          onClick={() => {
                            setBankChoice((c) => ({ ...c, [vendor.id]: "new" }));
                            setConfirmed((c) => ({ ...c, [vendor.id]: false }));
                          }}
                        >
                          Use new details
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="mt-[var(--space-sm)]">
                    <ModalDefinitionRow label="Account name">{details.accountName}</ModalDefinitionRow>
                    <ModalDefinitionRow label="Account number">{maskNumber(details.accountNumber)}</ModalDefinitionRow>
                    <ModalDefinitionRow label="Transit / routing number">{maskNumber(details.transitNumber, 2)}</ModalDefinitionRow>
                    <ModalDefinitionRow label="Source">
                      <Badge variant="neutral">
                        {details.source === "invoice" ? "Read from invoice" : `From your ${provider.name} contact`}
                      </Badge>
                    </ModalDefinitionRow>
                  </div>

                  {needsConfirm(vendor) && (
                    <label className="mt-[var(--space-sm)] flex items-start gap-[var(--space-sm)] text-body-sm text-content-primary">
                      <input
                        type="checkbox"
                        checked={!!confirmed[vendor.id]}
                        onChange={(e) => setConfirmed((c) => ({ ...c, [vendor.id]: e.target.checked }))}
                        className="mt-1 rounded border-border-strong text-accent focus:ring-accent"
                      />
                      <span>
                        <span className="font-semibold">Confirm details</span> — I&apos;ve checked these bank details are correct for {vendor.name}.
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </>
        )}

        {step === "approval" && (
          <>
            <div className="flex items-start gap-[var(--space-sm)] rounded-md border border-status-warning-border bg-status-warning-bg p-[var(--space-sm)] text-body-sm text-status-warning-text">
              <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
              <p>
                Needs approval from <span className="font-semibold">{approverNames(rules, team)}</span>.{" "}
                {rules.mode === "every" ? "Your rules require approval for every payment." : rules.threshold === null ? "Your rules require approval above your set limit." : `Your rules require approval above ${money(rules.threshold)}.`}
              </p>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-md border border-border">
              {flagged.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]">
                  <span className="min-w-0">
                    <span className="block truncate text-body-sm font-semibold text-content-primary">
                      {vendors.find((v) => v.id === b.vendorId)?.name}
                    </span>
                    <span className="block text-caption text-content-secondary">
                      {b.reference} · due {shortDate(b.dueDate)}
                    </span>
                  </span>
                  <span className="shrink-0 text-body-sm font-bold text-content-primary">{money(b.amount)}</span>
                </div>
              ))}
            </div>
            <p className="text-caption text-content-secondary">
              {flagged.length === activeBills.length
                ? "These bills move to Awaiting approval. Approvers get an email and can approve straight from it."
                : `These move to Awaiting approval; the other ${activeBills.length - flagged.length} bill${
                    activeBills.length - flagged.length === 1 ? " carries" : "s carry"
                  } on to payment.`}
            </p>
          </>
        )}

        {step === "payFrom" && (
          <>
            <p className="text-body-sm text-content-secondary">Choose the bank account to pay from.</p>
            {accounts.length === 0 && (
              <EmptyState
                icon={<Landmark size={28} strokeWidth={1.75} />}
                title="No bank accounts to pay from"
                description="Bank accounts connect through the backend (BE)"
              />
            )}
            <div className="flex flex-col gap-[var(--space-sm)]">
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className={`flex cursor-pointer items-center justify-between gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] ${
                    accountId === a.id ? "border-accent bg-surface-alt" : "border-border bg-page"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
                    <input type="radio" name="pay-from" checked={accountId === a.id} onChange={() => setAccountId(a.id)} />
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-content-primary">{a.name}</span>
                      <span className="block text-caption text-content-secondary">{maskNumber(a.mask)}</span>
                    </span>
                  </span>
                  <span className={`shrink-0 text-caption font-semibold ${a.balance < total ? "text-error" : "text-content-secondary"}`}>
                    Balance {money(a.balance)}
                  </span>
                </label>
              ))}
            </div>
            {account && account.balance < total && (
              <p className="text-caption font-semibold text-status-danger-text">This account&apos;s balance is lower than the run total.</p>
            )}
            <div>
              <ModalDefinitionRow label="Payments">{groups.length}</ModalDefinitionRow>
              <ModalDefinitionRow label="Bills">{activeBills.length}</ModalDefinitionRow>
              <ModalDefinitionRow label="Total">{money(total)}</ModalDefinitionRow>
            </div>
            <p className="text-caption text-content-secondary">
              Don&apos;t hold the bank login yourself? Request authorisation and the person who does gets a link to approve the run in
              their banking app.
            </p>
          </>
        )}

        {step === "success" && result && (
          <div className="flex flex-col items-center px-[var(--space-md)] py-[var(--space-lg)] text-center">
            <span className="mb-[var(--space-md)] flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              {result.kind === "paid" ? <CheckCircle2 size={30} strokeWidth={1.75} /> : result.kind === "auth" ? <Clock size={30} strokeWidth={1.75} /> : <Send size={28} strokeWidth={1.75} />}
            </span>
            <p className="text-h3 font-bold text-content-primary">
              {result.kind === "paid" ? "Payment sent" : result.kind === "auth" ? "Authorisation requested" : "Sent for approval"}
            </p>
            <p className="mt-[var(--space-xs)] max-w-sm text-body-sm text-content-secondary">
              {result.kind === "paid"
                ? `${money(result.total)} across ${result.count} bill${result.count === 1 ? "" : "s"} — it will be recorded as a bill payment in ${provider.name} once the bank confirms.`
                : result.kind === "auth"
                  ? `The run for ${money(result.total)} is waiting for the bank login holder to authorise it. Track it under Payment runs.`
                  : `${result.count} bill${result.count === 1 ? "" : "s"} (${money(result.total)}) moved to Awaiting approval. ${approverNames(rules, team)} will be emailed.`}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
