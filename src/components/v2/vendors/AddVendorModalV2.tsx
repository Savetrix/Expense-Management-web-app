"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { showToast } from "@/lib/dialogManager";
import { taxCodeId as getTaxCodeId, taxCodeLabel as formatTaxCodeLabel } from "@/lib/quickbooks/taxCode";
import { AddGlAccountModalV2 } from "@/components/v2/glTaxCode/AddGlAccountModalV2";
import { CreatableCombobox, Modal, SelectDropdown } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createQuickBooksVendor,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
} from "@/store/quickBooks/quickBooksApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

const GL_REQUIRED = "GL account is required to create a vendor";

export interface CreatedVendorRecord {
  _id: string;
  displayName: string;
  qbVendorId: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  glAccountId: string | null;
  taxCodeId: string | null;
}

interface AddVendorModalV2Props {
  open: boolean;
  onClose: () => void;
  /** Prefills the name field each time the modal opens. */
  initialName?: string;
  onCreated: (vendor: CreatedVendorRecord) => void;
}

// Create-only twin of the Add Vendor sheet on the Vendors page, for opening
// in place from other screens (e.g. the invoice review vendor dropdown).
export function AddVendorModalV2({ open, onClose, initialName = "", onCreated }: AddVendorModalV2Props) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const accountsLoadedForCompany = useAppSelector(
    (state) => state.quickBooks.accountsConnectionId === state.quickBooks.qbConnectionId,
  );
  const taxCodesLoadedForCompany = useAppSelector(
    (state) => state.quickBooks.taxCodesConnectionId === state.quickBooks.qbConnectionId,
  );

  const [displayName, setDisplayName] = useState("");
  const [currency, setCurrency] = useState<string>(CURRENCY_OPTIONS[0]);
  const [glAccountId, setGlAccountId] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addGlOpen, setAddGlOpen] = useState(false);
  const [addGlName, setAddGlName] = useState("");
  const glMissing = formError === GL_REQUIRED;

  useEffect(() => {
    if (!open) return;
    setDisplayName(initialName);
    setCurrency(CURRENCY_OPTIONS[0]);
    setGlAccountId("");
    setTaxCodeId("");
    setEmail("");
    setPhone("");
    setAddress("");
    setFormError("");
    setAddGlOpen(false);
    if (accessToken) {
      if (!accountsLoadedForCompany) dispatch(fetchQuickBooksAccounts({ accessToken }));
      if (!taxCodesLoadedForCompany) dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    }
    // Reset only on open; the loaded-flags/token are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    // Escape also reaches this modal while the nested Add GL Account one is
    // open — let only the top one close.
    if (saving || addGlOpen) return;
    onClose();
  };

  const handleSave = async () => {
    if (!accessToken) return;
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setFormError("Vendor name is required");
      return;
    }
    if (!glAccountId) {
      setFormError(GL_REQUIRED);
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const result = await dispatch(
        createQuickBooksVendor({
          accessToken,
          displayName: trimmedName,
          currency,
          glAccountId,
          taxCodeId,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
        }),
      );
      if (!createQuickBooksVendor.fulfilled.match(result)) {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not create vendor. Please try again.", "error");
        return;
      }

      // Same response-shape tolerance as useVendorResolution.
      const createdPayload = result.payload as Record<string, unknown>;
      const data = createdPayload?.data as Record<string, unknown> | undefined;
      const created = (data?.vendor || data?.Vendor || createdPayload?.vendor || createdPayload?.Vendor || data ||
        createdPayload ||
        {}) as Record<string, unknown>;

      // Refetch so the new vendor shows up in the dropdown list.
      await dispatch(fetchQuickBooksVendors({ accessToken }));

      showToast(`${trimmedName} added.`, "success");
      onCreated({
        _id: (created?._id as string) || "",
        displayName: (created?.displayName as string) || (created?.DisplayName as string) || trimmedName,
        qbVendorId: (created?.qbVendorId as string) || (created?.Id as string) || "",
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        glAccountId: (created?.glAccountId as string) || glAccountId || null,
        taxCodeId: (created?.taxCodeId as string) || taxCodeId || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Modal
      open={open}
      onClose={handleClose}
      widthClassName="max-w-2xl"
      title="Add Vendor"
      footer={
        <Button onClick={handleSave} loading={saving} disabled={saving} className="w-full">
          Create vendor
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={FIELD_LABEL_CLASS}>Vendor name *</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter vendor name"
            disabled={saving}
            className={FIELD_INPUT_CLASS}
          />
        </div>

        <div>
          <SelectDropdown label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={saving}>
            {CURRENCY_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </SelectDropdown>
        </div>

        <div>
          <div className="flex flex-col gap-[var(--space-xs)]">
            <label className={FIELD_LABEL_CLASS}>GL account *</label>
            <CreatableCombobox
              uiSize="md"
              options={glAccounts.map((account) => ({ id: account.qbAccountId, label: account.name }))}
              noun="GL account"
              ariaLabel="GL account"
              value={glAccountId}
              placeholder="Select GL account"
              error={glMissing ? formError : undefined}
              disabled={saving}
              onSelect={(id) => {
                setGlAccountId(id);
                if (id && glMissing) setFormError("");
              }}
              onAddNew={(name) => {
                setAddGlName(name);
                setAddGlOpen(true);
              }}
            />
            {glMissing && <p className="text-caption font-medium text-status-danger-text">{formError}</p>}
          </div>
          {glAccounts.length === 0 && (
            <p className="mt-[var(--space-xs)] text-caption text-content-secondary">
              No GL accounts found. Sync them from {provider.name} first.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <SelectDropdown label="Tax code" value={taxCodeId} onChange={(e) => setTaxCodeId(e.target.value)} disabled={saving}>
            <option value="">
              {`Select tax code (not applicable if your ${provider.companyNoun} doesn't use tax codes)`}
            </option>
            {taxCodes.map((code) => (
              <option key={getTaxCodeId(code)} value={getTaxCodeId(code)}>
                {formatTaxCodeLabel(code)}
              </option>
            ))}
          </SelectDropdown>
        </div>

        <div>
          <label className={FIELD_LABEL_CLASS}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vendor@company.com"
            disabled={saving}
            className={FIELD_INPUT_CLASS}
          />
        </div>

        <div>
          <label className={FIELD_LABEL_CLASS}>Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 000 0000"
            disabled={saving}
            className={FIELD_INPUT_CLASS}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={FIELD_LABEL_CLASS}>Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, city, country"
            disabled={saving}
            className={FIELD_INPUT_CLASS}
          />
        </div>

        {formError && !glMissing && (
          <p className="sm:col-span-2 text-caption font-semibold text-status-danger-text">{formError}</p>
        )}
      </div>
    </Modal>

    <AddGlAccountModalV2
      open={addGlOpen}
      onClose={() => setAddGlOpen(false)}
      initialName={addGlName}
      onCreated={(account) => {
        setGlAccountId(account.qbAccountId);
        setFormError("");
      }}
    />
    </>
  );
}
