"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { CreatableCombobox, TextInput } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import { saveExpenseSettings, type ExpenseSettingsDto, type SettingsPatch } from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksAccounts } from "@/store/quickBooks/quickBooksApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { CARD_CLASS, canEditSettings, errorMessage, money, type CompanyRole } from "./shared";

interface ExpenseSettingsTabProps {
  settings: ExpenseSettingsDto | null;
  settingsLoading: boolean;
  settingsError: string | null;
  onRetry: () => void;
  role: CompanyRole;
}

type SavingSection = "mileage" | "approval";

const rateText = (n: number | null | undefined) => (n == null ? "" : String(n));

function SectionCard({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className={CARD_CLASS}>
      <div className="border-b border-border bg-page p-[var(--space-md)]">
        <h2 className="text-h3 font-bold text-content-primary">{title}</h2>
        <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">{description}</p>
      </div>
      <div className="p-[var(--space-md)]">{children}</div>
      {footer && <div className="flex justify-end border-t border-border px-[var(--space-md)] py-[var(--space-sm)]">{footer}</div>}
    </section>
  );
}

export function ExpenseSettingsTab({ settings, settingsLoading, settingsError, onRetry, role }: ExpenseSettingsTabProps) {
  if (settingsLoading && !settings) {
    return (
      <div className="mt-[var(--space-md)] flex justify-center p-[var(--space-xl)]">
        <Spinner />
      </div>
    );
  }
  if (!settings) {
    return (
      <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
        <ErrorState message={settingsError ?? "Couldn't load expense settings."} onRetry={onRetry} />
      </div>
    );
  }
  return <SettingsEditor settings={settings} role={role} />;
}

function SettingsEditor({ settings, role }: { settings: ExpenseSettingsDto; role: CompanyRole }) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const canEdit = canEditSettings(role);
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const { accounts, accountsConnectionId } = useAppSelector((state) => state.quickBooks);

  const [saving, setSaving] = useState<SavingSection | null>(null);
  const [rate, setRate] = useState(() => rateText(settings.mileageRate));
  const [mileageAccount, setMileageAccount] = useState(settings.mileageGlAccountId ?? "");
  const [rateError, setRateError] = useState("");

  // When the saved values change (a save, a reload), the draft restarts from
  // them. Adjusted during render, React's pattern for state derived from a
  // changed prop.
  const saved = JSON.stringify([settings.mileageRate, settings.mileageGlAccountId]);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setRate(rateText(settings.mileageRate));
    setMileageAccount(settings.mileageGlAccountId ?? "");
    setSeen(saved);
  }

  useEffect(() => {
    if (canEdit && accessToken && qbConnectionId && accountsConnectionId !== qbConnectionId) {
      dispatch(fetchQuickBooksAccounts({ accessToken }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, qbConnectionId]);

  const accountOptions = useMemo(
    () => (accountsConnectionId === qbConnectionId ? accounts : []).map((a) => ({ id: a.qbAccountId, label: a.name })),
    [accounts, accountsConnectionId, qbConnectionId],
  );
  const accountName = accountOptions.find((a) => a.id === settings.mileageGlAccountId)?.label;

  const save = async (section: SavingSection, patch: SettingsPatch, success: string) => {
    setSaving(section);
    const result = await dispatch(saveExpenseSettings(patch));
    setSaving(null);
    if (saveExpenseSettings.fulfilled.match(result)) showToast(success, "success");
    else showToast(errorMessage(result.payload, "Couldn't save the settings."), "error");
  };

  const parsedRate = rate.trim() === "" ? null : Number(rate);
  const mileageDirty = parsedRate !== (settings.mileageRate ?? null) || (mileageAccount || null) !== (settings.mileageGlAccountId ?? null);

  const saveMileage = () => {
    if (parsedRate !== null && (Number.isNaN(parsedRate) || parsedRate <= 0 || parsedRate > 1000)) {
      return setRateError("Enter a rate above zero per km, or leave it empty.");
    }
    setRateError("");
    return save("mileage", { mileageRate: parsedRate, mileageGlAccountId: mileageAccount || null }, "Mileage settings saved — new trips use this rate.");
  };

  return (
    <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-md)] lg:grid-cols-2">
      <SectionCard
        title="Mileage"
        description="What the company pays per km of business travel, and where those bills are booked. Trips already logged keep the rate they were logged with."
        footer={
          canEdit ? (
            <Button size="sm" onClick={saveMileage} loading={saving === "mileage"} disabled={!mileageDirty || !!saving}>
              Save
            </Button>
          ) : undefined
        }
      >
        {canEdit ? (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <TextInput label="Rate per km" inputMode="decimal" placeholder="Not set" value={rate} onChange={(e) => setRate(e.target.value)} />
              {parsedRate !== null && !Number.isNaN(parsedRate) && parsedRate > 0 && (
                <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Example: a 50 km trip pays {money(50 * parsedRate)}.</p>
              )}
              {rateError && <p className="mt-[var(--space-xs)] text-caption font-semibold text-status-danger-text">{rateError}</p>}
            </div>
            <div>
              <p className="mb-[var(--space-xs)] text-body-sm font-semibold text-content-primary">{provider.name} GL account</p>
              <CreatableCombobox
                options={accountOptions}
                noun="GL account"
                ariaLabel="Mileage GL account"
                value={mileageAccount}
                onSelect={setMileageAccount}
                clearLabel="No account"
                placeholder="Search GL accounts"
                uiSize="md"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-xs)] text-body-sm text-content-secondary">
            <p>
              <span className="font-semibold text-content-primary">Rate per km:</span>{" "}
              {settings.mileageRate == null ? "not set yet" : money(settings.mileageRate)}
            </p>
            <p>
              <span className="font-semibold text-content-primary">GL account:</span>{" "}
              {settings.mileageGlAccountId ? accountName ?? "set" : "not set yet"}
            </p>
            <p className="text-caption">Only the owner or an admin can change these.</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Approvals" description="Nobody approves a claim they created or that's theirs unless this is on.">
        <div className="flex items-center justify-between gap-[var(--space-md)]">
          <div>
            <p className="text-body-sm font-semibold text-content-primary">Allow self-approval</p>
            <p className="text-caption text-content-secondary">
              Turn on for a one-person company, where nobody else could approve. {canEdit ? "" : "Only the owner or an admin can change this."}
            </p>
          </div>
          <Switch
            checked={settings.allowSelfApproval}
            onChange={(v) => save("approval", { allowSelfApproval: v }, v ? "Self-approval allowed." : "Self-approval turned off.")}
            disabled={!canEdit || !!saving}
            label="Allow self-approval"
          />
        </div>
      </SectionCard>

      <SectionCard title="Who can do what" description="Follows each person's role on the Team page.">
        <div className="flex flex-col gap-[var(--space-sm)] text-body-sm text-content-secondary">
          <div className="flex items-start gap-[var(--space-sm)]">
            <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
            <p>
              <span className="font-semibold text-content-primary">Members</span> send their own receipts for approval and log their own trips.
            </p>
          </div>
          <div className="flex items-start gap-[var(--space-sm)]">
            <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
            <p>
              <span className="font-semibold text-content-primary">Owners, admins and accountants</span> approve or reject the claims and trips sent to
              them (approving posts them to {provider.name}) and record them as paid.
            </p>
          </div>
          <div className="flex items-start gap-[var(--space-sm)]">
            <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
            <p>
              <span className="font-semibold text-content-primary">Owners and admins</span> set the mileage rate and these settings.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
