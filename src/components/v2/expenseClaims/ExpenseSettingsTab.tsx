"use client";

import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { CreatableCombobox, SelectDropdown, TextInput } from "@/components/v2/ui";
import { showToast } from "@/lib/dialogManager";
import {
  FUEL_TYPES,
  VEHICLE_TYPES,
  saveExpenseSettings,
  type ExpenseSettingsDto,
  type FuelType,
  type SettingsPatch,
  type VehicleDto,
  type VehicleOwnership,
  type VehicleType,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchQuickBooksAccounts } from "@/store/quickBooks/quickBooksApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { CARD_CLASS, canChangeSelfApproval, errorMessage, isApprover, money, type CompanyRole } from "./shared";
import type { TeamPerson } from "./useTeamMembers";

interface ExpenseSettingsTabProps {
  members: TeamPerson[];
  membersLoading: boolean;
  membersError: string;
  settings: ExpenseSettingsDto | null;
  settingsLoading: boolean;
  settingsError: string | null;
  onRetry: () => void;
  role: CompanyRole;
}

type DraftVehicle = Pick<VehicleDto, "name" | "vehicleType" | "fuelType" | "ownership"> & { id?: string; key: string };
type RateDraft = Record<VehicleType, Record<FuelType, string>>;
type SavingSection = "vehicles" | "rates" | "account" | "approval";

let draftKey = 0;
const toDraft = (v: VehicleDto): DraftVehicle => ({ ...v, key: v.id });
const rateText = (n: number | null | undefined) => (n == null ? "" : String(n));
const toRateDraft = (rates: ExpenseSettingsDto["rates"]): RateDraft =>
  Object.fromEntries(
    VEHICLE_TYPES.map((t) => [t, Object.fromEntries(FUEL_TYPES.map((f) => [f, rateText(rates?.[t]?.[f])]))]),
  ) as RateDraft;

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

export function ExpenseSettingsTab({ settings, settingsLoading, settingsError, onRetry, ...rest }: ExpenseSettingsTabProps) {
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
  return <SettingsEditor settings={settings} {...rest} />;
}

type SettingsEditorProps = Omit<ExpenseSettingsTabProps, "settings" | "settingsLoading" | "settingsError" | "onRetry"> & {
  settings: ExpenseSettingsDto;
};

function SettingsEditor({ members, membersLoading, membersError, settings, role }: SettingsEditorProps) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const canEdit = isApprover(role);
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const { accounts, accountsConnectionId } = useAppSelector((state) => state.quickBooks);

  const [saving, setSaving] = useState<SavingSection | null>(null);
  const [vehicleDraft, setVehicleDraft] = useState<DraftVehicle[]>(() => settings.vehicles.map(toDraft));
  const [newVehicle, setNewVehicle] = useState<{ name: string; vehicleType: VehicleType; fuelType: FuelType; ownership: VehicleOwnership }>({
    name: "",
    vehicleType: "Car",
    fuelType: "Petrol",
    ownership: "personal",
  });
  const [rates, setRates] = useState<RateDraft>(() => toRateDraft(settings.rates));
  const [passengerRate, setPassengerRate] = useState(() => rateText(settings.passengerRate));
  const [rateError, setRateError] = useState("");
  const [mileageAccount, setMileageAccount] = useState(settings.mileageGlAccountId ?? "");

  // When a section's saved value changes (its own save, or a reload), only
  // that section's draft restarts from it — unsaved edits in the other
  // sections stay. Adjusted during render, React's pattern for state derived
  // from a changed prop.
  const savedVehicles = JSON.stringify(settings.vehicles);
  const savedRates = JSON.stringify([settings.rates, settings.passengerRate]);
  const savedAccount = settings.mileageGlAccountId ?? "";
  const [seen, setSeen] = useState({ vehicles: savedVehicles, rates: savedRates, account: savedAccount });
  if (seen.vehicles !== savedVehicles || seen.rates !== savedRates || seen.account !== savedAccount) {
    if (seen.vehicles !== savedVehicles) setVehicleDraft(settings.vehicles.map(toDraft));
    if (seen.rates !== savedRates) {
      setRates(toRateDraft(settings.rates));
      setPassengerRate(rateText(settings.passengerRate));
    }
    if (seen.account !== savedAccount) setMileageAccount(savedAccount);
    setSeen({ vehicles: savedVehicles, rates: savedRates, account: savedAccount });
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

  const save = async (section: SavingSection, patch: SettingsPatch, success: string) => {
    setSaving(section);
    const result = await dispatch(saveExpenseSettings(patch));
    setSaving(null);
    if (saveExpenseSettings.fulfilled.match(result)) showToast(success, "success");
    else showToast(errorMessage(result.payload, "Couldn't save the settings."), "error");
  };

  const vehiclesDirty =
    vehicleDraft.length !== settings.vehicles.length || vehicleDraft.some((v, i) => v.id !== settings.vehicles[i]?.id);

  const parsedRates = VEHICLE_TYPES.flatMap((t) =>
    FUEL_TYPES.map((f) => ({ type: t, fuel: f, value: rates[t][f].trim() === "" ? null : Number(rates[t][f]) })),
  );
  const parsedPassenger = passengerRate.trim() === "" ? null : Number(passengerRate);
  const ratesDirty =
    parsedRates.some(({ type, fuel, value }) => value !== (settings.rates?.[type]?.[fuel] ?? null)) ||
    parsedPassenger !== (settings.passengerRate ?? null);

  const addVehicle = () => {
    const name = newVehicle.name.trim();
    if (!name) return;
    setVehicleDraft((prev) => [
      ...prev,
      { name, vehicleType: newVehicle.vehicleType, fuelType: newVehicle.fuelType, ownership: newVehicle.ownership, key: `new-${++draftKey}` },
    ]);
    setNewVehicle({ name: "", vehicleType: "Car", fuelType: "Petrol", ownership: "personal" });
  };

  const saveVehicles = () =>
    save(
      "vehicles",
      { vehicles: vehicleDraft.map(({ id, name, vehicleType, fuelType, ownership }) => ({ ...(id && { id }), name, vehicleType, fuelType, ownership })) },
      "Vehicles saved.",
    );

  const saveRates = () => {
    const bad = parsedRates.find(({ value }) => value !== null && (Number.isNaN(value) || value <= 0));
    if (bad) return setRateError(`Enter a ${bad.fuel.toLowerCase()} ${bad.type.toLowerCase()} rate above zero, or leave it blank.`);
    if (parsedPassenger !== null && (Number.isNaN(parsedPassenger) || parsedPassenger < 0)) {
      return setRateError("Enter a passenger rate of zero or more, or leave it blank.");
    }
    setRateError("");
    return save(
      "rates",
      {
        rates: Object.fromEntries(
          VEHICLE_TYPES.map((t) => [t, Object.fromEntries(parsedRates.filter((r) => r.type === t).map((r) => [r.fuel, r.value]))]),
        ),
        passengerRate: parsedPassenger,
      },
      "Mileage rates saved — new journeys use them from now on.",
    );
  };

  const exampleRate = parsedRates.find(({ value }) => value !== null && value > 0);

  return (
    <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-md)] lg:grid-cols-2">
      <SectionCard title="Drivers" description="Your team members can log journeys. Add or remove people on the Team page.">
        <div className="flex flex-col gap-[var(--space-sm)]">
          {membersError ? (
            <p className="text-body-sm text-status-danger-text">{membersError}</p>
          ) : membersLoading && members.length === 0 ? (
            <p className="text-body-sm text-content-secondary">Loading team members…</p>
          ) : members.length === 0 ? (
            <p className="text-body-sm text-content-secondary">No team members yet. Invite people on the Team page and they appear here.</p>
          ) : (
            members.map((m) => (
              <div
                key={m.userId}
                className="flex items-center justify-between gap-[var(--space-sm)] rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-content-primary">{m.name}</span>
                  {m.email && m.email !== m.name && <span className="block truncate text-caption text-content-secondary">{m.email}</span>}
                </span>
                <Badge variant="neutral">{m.role}</Badge>
              </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Vehicles"
        description="Vehicles drivers can claim for. The vehicle type and fuel type decide which rate applies."
        footer={
          canEdit ? (
            <Button size="sm" onClick={saveVehicles} loading={saving === "vehicles"} disabled={!vehiclesDirty || !!saving}>
              Save
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-[var(--space-sm)]">
          {vehicleDraft.length === 0 && <p className="text-body-sm text-content-secondary">No vehicles yet{canEdit ? " — add one below" : ""}.</p>}
          {vehicleDraft.map((v) => (
            <div
              key={v.key}
              className="flex items-center justify-between gap-[var(--space-sm)] rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-content-primary">{v.name}</span>
                <span className="mt-[var(--space-xs)] flex flex-wrap gap-[var(--space-xs)]">
                  <Badge variant="neutral">{v.vehicleType}</Badge>
                  <Badge variant="neutral">{v.fuelType}</Badge>
                  <Badge variant="neutral">{v.ownership === "company" ? "Company" : "Personal"}</Badge>
                </span>
              </span>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${v.name}`}
                  onClick={() => setVehicleDraft((prev) => prev.filter((x) => x.key !== v.key))}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-error hover:bg-error/10"
                >
                  <Trash2 size={16} strokeWidth={2.25} />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="flex flex-col gap-[var(--space-sm)] rounded-md border border-dashed border-border p-[var(--space-sm)]">
              <TextInput
                label="Add vehicle"
                placeholder="e.g. Grey Transit van"
                value={newVehicle.name}
                onChange={(e) => setNewVehicle((n) => ({ ...n, name: e.target.value }))}
              />
              <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-3">
                <SelectDropdown
                  label="Vehicle type"
                  value={newVehicle.vehicleType}
                  onChange={(e) => setNewVehicle((n) => ({ ...n, vehicleType: e.target.value as VehicleType }))}
                >
                  {VEHICLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </SelectDropdown>
                <SelectDropdown
                  label="Fuel type"
                  value={newVehicle.fuelType}
                  onChange={(e) => setNewVehicle((n) => ({ ...n, fuelType: e.target.value as FuelType }))}
                >
                  {FUEL_TYPES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </SelectDropdown>
                <SelectDropdown
                  label="Owned by"
                  value={newVehicle.ownership}
                  onChange={(e) => setNewVehicle((n) => ({ ...n, ownership: e.target.value as VehicleOwnership }))}
                >
                  <option value="personal">Personal</option>
                  <option value="company">Company</option>
                </SelectDropdown>
              </div>
              <Button variant="outline" size="sm" onClick={addVehicle} disabled={!newVehicle.name.trim()}>
                <Plus size={16} strokeWidth={2.5} />
                Add to list
              </Button>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Mileage rates"
        description="Per km, by vehicle type and fuel type. Applied to every new journey; existing journeys keep the rate they were logged with."
        footer={
          canEdit ? (
            <Button size="sm" onClick={saveRates} loading={saving === "rates"} disabled={!ratesDirty || !!saving}>
              Save rates
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-[var(--space-md)]">
          {VEHICLE_TYPES.map((t) => (
            <div key={t}>
              <p className="text-body-sm font-semibold text-content-primary">{t}</p>
              <div className="mt-[var(--space-xs)] grid grid-cols-2 gap-[var(--space-sm)] sm:grid-cols-4">
                {FUEL_TYPES.map((f) => (
                  <TextInput
                    key={f}
                    label={f}
                    inputMode="decimal"
                    placeholder="Not set"
                    value={rates[t][f]}
                    onChange={(e) => setRates((r) => ({ ...r, [t]: { ...r[t], [f]: e.target.value } }))}
                    disabled={!canEdit}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
          <TextInput
            label="Passenger per km"
            inputMode="decimal"
            placeholder="Not set"
            value={passengerRate}
            onChange={(e) => setPassengerRate(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        {exampleRate && (
          <p className="mt-[var(--space-sm)] text-caption text-content-secondary">
            Example: a 50 km journey in a {exampleRate.fuel.toLowerCase()} {exampleRate.type.toLowerCase()} with a passenger pays{" "}
            {money(50 * ((exampleRate.value ?? 0) + (parsedPassenger && !Number.isNaN(parsedPassenger) ? parsedPassenger : 0)))}.
          </p>
        )}
        {rateError && <p className="mt-[var(--space-xs)] text-caption font-semibold text-status-danger-text">{rateError}</p>}
      </SectionCard>

      <SectionCard
        title="Mileage account"
        description={`The ${provider.name} GL account mileage bills are coded to.`}
        footer={
          canEdit ? (
            <Button
              size="sm"
              onClick={() => save("account", { mileageGlAccountId: mileageAccount || null }, "Mileage account saved.")}
              loading={saving === "account"}
              disabled={(mileageAccount || null) === settings.mileageGlAccountId || !!saving}
            >
              Save
            </Button>
          ) : undefined
        }
      >
        {canEdit ? (
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
        ) : (
          <p className="text-body-sm text-content-secondary">
            {settings.mileageGlAccountId ? "Set by your team." : "Not set yet — someone with approval rights chooses it."}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Approvals"
        description="Who can approve a claim. Nobody approves a claim they created or that's theirs unless this is on."
        footer={undefined}
      >
        <div className="flex items-center justify-between gap-[var(--space-md)]">
          <div>
            <p className="text-body-sm font-semibold text-content-primary">Allow self-approval</p>
            <p className="text-caption text-content-secondary">
              Turn on for a one-person company, where nobody else could approve. {canChangeSelfApproval(role) ? "" : "Only the owner or an admin can change this."}
            </p>
          </div>
          <Switch
            checked={settings.allowSelfApproval}
            onChange={(v) => save("approval", { allowSelfApproval: v }, v ? "Self-approval allowed." : "Self-approval turned off.")}
            disabled={!canChangeSelfApproval(role) || !!saving}
            label="Allow self-approval"
          />
        </div>
      </SectionCard>

      <SectionCard title="Who can do what" description="Follows each person's role on the Team page.">
        <div className="flex flex-col gap-[var(--space-sm)] text-body-sm text-content-secondary">
          <div className="flex items-start gap-[var(--space-sm)]">
            <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
            <p>
              <span className="font-semibold text-content-primary">Contributors</span> create claims and journeys for themselves and see only their
              own.
            </p>
          </div>
          <div className="flex items-start gap-[var(--space-sm)]">
            <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
            <p>
              <span className="font-semibold text-content-primary">Owners, admins and accountants</span> see every claim, approve or remove receipts,
              publish to {provider.name} and mark claims as paid.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
