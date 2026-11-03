"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal, ModalDefinitionRow, SelectDropdown, TextInput } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { fetchBankAccounts, payExpenseClaim, type BankAccountDto, type ExpenseClaimDto } from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";

import { errorMessage, money, todayIso } from "./shared";

interface PayClaimModalProps {
  /** The claim to pay; null = closed. */
  claim: ExpenseClaimDto | null;
  providerName: string;
  onClose: () => void;
}

// "Pay employee": records the payment of the claim's bill in QuickBooks/Xero
// from one of the company's bank accounts and marks the claim paid. Scantrix
// doesn't send the money — the payment is made as usual, this books it.
export function PayClaimModal({ claim, providerName, onClose }: PayClaimModalProps) {
  const dispatch = useAppDispatch();
  const [accounts, setAccounts] = useState<{ forClaim: string; list: BankAccountDto[]; error: string } | null>(null);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [paying, setPaying] = useState(false);

  const claimId = claim?.id ?? "";
  useEffect(() => {
    if (!claimId) return;
    let cancelled = false;
    dispatch(fetchBankAccounts()).then((result) => {
      if (cancelled) return;
      if (fetchBankAccounts.fulfilled.match(result)) {
        setAccounts({ forClaim: claimId, list: result.payload, error: "" });
        setAccountId((current) => current || result.payload[0]?.externalId || "");
      } else {
        setAccounts({ forClaim: claimId, list: [], error: errorMessage(result.payload, "Couldn't load bank accounts.") });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [claimId, dispatch]);

  if (!claim) return null;
  const loaded = accounts?.forClaim === claim.id ? accounts : null;

  const close = () => {
    if (paying) return;
    setAccountId("");
    setDate(todayIso());
    setAccounts(null);
    onClose();
  };

  const handlePay = async () => {
    if (!accountId) return;
    setPaying(true);
    const result = await dispatch(payExpenseClaim({ id: claim.id, bankAccountId: accountId, date }));
    setPaying(false);
    if (payExpenseClaim.fulfilled.match(result)) {
      showToast(`Payment to ${claim.claimant.name} recorded in ${providerName}.`, "success");
      close();
    } else {
      showToast(errorMessage(result.payload, "Couldn't record the payment."), "error");
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Pay ${claim.claimant.name}`}
      widthClassName="max-w-lg"
      footer={
        <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
          <Button variant="outline" size="sm" onClick={close} disabled={paying}>
            Cancel
          </Button>
          <Button size="sm" onClick={handlePay} loading={paying} disabled={paying || !accountId || !date}>
            Record payment
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div>
          <ModalDefinitionRow label="Claimant">{claim.claimant.name}</ModalDefinitionRow>
          <ModalDefinitionRow label="Claim total">{money(claim.total, claim.currency)}</ModalDefinitionRow>
        </div>

        {!loaded ? (
          <div className="flex justify-center p-[var(--space-md)]">
            <Spinner />
          </div>
        ) : loaded.error ? (
          <p className="text-body-sm font-semibold text-status-danger-text">{loaded.error}</p>
        ) : loaded.list.length === 0 ? (
          <p className="text-body-sm text-content-secondary">No bank accounts found in {providerName}. Add one there, then try again.</p>
        ) : (
          <SelectDropdown label="Paid from *" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {loaded.list.map((a) => (
              <option key={a.externalId} value={a.externalId}>
                {a.name}
                {a.currency ? ` · ${a.currency}` : ""}
              </option>
            ))}
          </SelectDropdown>
        )}

        <TextInput label="Payment date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <p className="text-caption text-content-secondary">
          This records a payment of the claim&apos;s bill in {providerName} for whatever is still open on it, and marks the claim paid. Scantrix
          doesn&apos;t send the money — pay {claim.claimant.name} as you usually do.
        </p>
      </div>
    </Modal>
  );
}
