"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal, ModalDefinitionRow, SelectDropdown, TextInput } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { fetchBankAccounts, type BankAccountDto } from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";

import { errorMessage, money, todayIso } from "./shared";

/** An approved claim or mileage trip whose bill is being paid. */
export interface PayTarget {
  id: string;
  noun: "claim" | "trip";
  payee: string;
  amount: number;
  currency: string | null;
}

interface PayEmployeeModalProps {
  /** What to pay; null = closed. */
  target: PayTarget | null;
  providerName: string;
  /** Records the payment (the claim's or the trip's thunk); ok=false keeps the modal open. */
  onPay: (target: PayTarget, bankAccountId: string, date: string) => Promise<{ ok: boolean; payload?: unknown }>;
  onClose: () => void;
}

// "Pay employee": records the payment of a claim's or trip's bill in
// QuickBooks/Xero from one of the company's bank accounts and marks it paid.
// Scantrix doesn't send the money — the payment is made as usual, this books it.
export function PayEmployeeModal({ target, providerName, onPay, onClose }: PayEmployeeModalProps) {
  const dispatch = useAppDispatch();
  const [accounts, setAccounts] = useState<{ forId: string; list: BankAccountDto[]; error: string } | null>(null);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [paying, setPaying] = useState(false);

  const targetId = target?.id ?? "";
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    dispatch(fetchBankAccounts()).then((result) => {
      if (cancelled) return;
      if (fetchBankAccounts.fulfilled.match(result)) {
        setAccounts({ forId: targetId, list: result.payload, error: "" });
        setAccountId((current) => current || result.payload[0]?.externalId || "");
      } else {
        setAccounts({ forId: targetId, list: [], error: errorMessage(result.payload, "Couldn't load bank accounts.") });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [targetId, dispatch]);

  if (!target) return null;
  const loaded = accounts?.forId === target.id ? accounts : null;

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
    const result = await onPay(target, accountId, date);
    setPaying(false);
    if (result.ok) {
      showToast(`Payment to ${target.payee} recorded in ${providerName}.`, "success");
      close();
    } else {
      showToast(errorMessage(result.payload, "Couldn't record the payment."), "error");
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Pay ${target.payee}`}
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
          <ModalDefinitionRow label="Pay to">{target.payee}</ModalDefinitionRow>
          <ModalDefinitionRow label={target.noun === "claim" ? "Claim total" : "Trip amount"}>{money(target.amount, target.currency)}</ModalDefinitionRow>
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
          This records a payment of the {target.noun}&apos;s bill in {providerName} for whatever is still open on it, and marks the {target.noun}{" "}
          paid. Scantrix doesn&apos;t send the money — pay {target.payee} as you usually do.
        </p>
      </div>
    </Modal>
  );
}
