"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal, SelectDropdown, TextInput } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";

import { formatAmount } from "./format";
import type { BankAccount, BankTransaction } from "./types";

export function accountLabel(a: BankAccount): string {
  return `${a.institutionName} ${a.name}${a.mask ? ` ••${a.mask}` : ""}`.trim();
}

interface TransferModalProps {
  txn: BankTransaction;
  bankAccounts: BankAccount[];
  onClose: () => void;
  onSave: (counterpart: string) => void;
}

export function TransferModal({ txn, bankAccounts, onClose, onSave }: TransferModalProps) {
  const [counterpart, setCounterpart] = useState(txn.transferAccount ?? "");
  const hasAccounts = bankAccounts.length > 0;
  const value = counterpart.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title="Mark as transfer"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!value}
            onClick={() => {
              notifyBackendPending("Save transfer");
              onSave(value);
            }}
          >
            {beLabel("Save transfer")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <p className="text-body-sm text-content-secondary">
          {txn.description || "This line"} ({formatAmount(txn.amount)}) moved money between two of your own accounts, so it is not an expense or income.
        </p>
        {hasAccounts ? (
          <SelectDropdown label={txn.amount < 0 ? "Moved to" : "Moved from"} value={counterpart} onChange={(e) => setCounterpart(e.target.value)}>
            <option value="">Pick an account</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={accountLabel(a)}>
                {accountLabel(a)}
              </option>
            ))}
          </SelectDropdown>
        ) : (
          <TextInput
            label={txn.amount < 0 ? "Moved to (account name)" : "Moved from (account name)"}
            value={counterpart}
            onChange={(e) => setCounterpart(e.target.value)}
            placeholder="e.g. Savings account"
          />
        )}
      </div>
    </Modal>
  );
}
