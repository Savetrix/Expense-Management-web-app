"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { PROVIDERS } from "@/lib/accountingProvider";
import { showToast } from "@/lib/dialogManager";
import { Modal } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createQuickBooksAccount, fetchQuickBooksAccounts } from "@/store/quickBooks/quickBooksApi";
import { selectActiveProviderId, type GLAccount } from "@/store/quickBooks/quickBooksSlice";

const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

interface AddGlAccountModalV2Props {
  open: boolean;
  onClose: () => void;
  /** Prefills the name field each time the modal opens. */
  initialName?: string;
  /** Fires with the new account once it shows up in the refreshed list. */
  onCreated: (account: GLAccount) => void;
}

// Create-only twin of the Add GL Account sheet on the GL Account & TaxCode
// page, for opening in place (e.g. from the invoice review GL dropdown).
export function AddGlAccountModalV2({ open, onClose, initialName = "", onCreated }: AddGlAccountModalV2Props) {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const activeProviderId = useAppSelector(selectActiveProviderId);
  const provider = PROVIDERS[activeProviderId];

  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [accountSubType, setAccountSubType] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setAccountType(provider.accountTypes[0].value);
    setAccountSubType("");
    setCode("");
    setFormError("");
    // Reset only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSave = async () => {
    if (!accessToken) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Account name is required");
      return;
    }
    const trimmedCode = code.trim();
    if (provider.accountCodeRequired && !trimmedCode) {
      setFormError(`Account code is required in ${provider.name}`);
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const result = await dispatch(
        createQuickBooksAccount({
          accessToken,
          name: trimmedName,
          accountType,
          accountSubType: provider.accountSubTypeSupported ? accountSubType.trim() || undefined : undefined,
          code: provider.accountCodeRequired ? trimmedCode : undefined,
        }),
      );
      if (!createQuickBooksAccount.fulfilled.match(result)) {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not create GL account. Please try again.", "error");
        return;
      }

      // The create response shape isn't relied on — refetch, then find the
      // new account in the list by name so the caller gets its real id.
      const refetch = await dispatch(fetchQuickBooksAccounts({ accessToken }));
      const list: GLAccount[] = Array.isArray(refetch.payload) ? (refetch.payload as GLAccount[]) : [];
      const target = trimmedName.toLowerCase();
      const created = list.find((a) => a.name?.trim().toLowerCase() === target);

      showToast(`${trimmedName} added.`, "success");
      if (created) onCreated(created);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add GL Account"
      footer={
        <Button onClick={handleSave} loading={saving} disabled={saving} className="w-full">
          Create GL account
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div>
          <label className={FIELD_LABEL_CLASS}>Account name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Office Rent"
            disabled={saving}
            className={FIELD_INPUT_CLASS}
          />
        </div>

        <div>
          <label className={FIELD_LABEL_CLASS}>Account type *</label>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            disabled={saving}
            className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {provider.accountTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {provider.accountCodeRequired && (
          <div>
            <label className={FIELD_LABEL_CLASS}>Account code *</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 429"
              maxLength={10}
              disabled={saving}
              className={FIELD_INPUT_CLASS}
            />
          </div>
        )}

        {provider.accountSubTypeSupported && (
          <div>
            <label className={FIELD_LABEL_CLASS}>Account subtype</label>
            <input
              value={accountSubType}
              onChange={(e) => setAccountSubType(e.target.value)}
              placeholder="e.g. RentOrLeaseOfBuildings (optional)"
              disabled={saving}
              className={FIELD_INPUT_CLASS}
            />
          </div>
        )}

        {formError && <p className="text-caption font-semibold text-status-danger-text">{formError}</p>}
      </div>
    </Modal>
  );
}
