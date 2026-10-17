"use client";

import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectDropdown, TextInput } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";

import type { Driver, FuelType, MileageRates, Vehicle, VehicleOwnership } from "./mockData";
import { CARD_CLASS, mockId, money } from "./shared";

interface ExpenseSettingsTabProps {
  drivers: Driver[];
  vehicles: Vehicle[];
  rates: MileageRates;
  onSaveDrivers: (drivers: Driver[]) => void;
  onSaveVehicles: (vehicles: Vehicle[]) => void;
  onSaveRates: (rates: MileageRates) => void;
}

const FUEL_TYPES: FuelType[] = ["Petrol", "Diesel", "Electric", "Hybrid"];

const sameIds = (a: { id: string }[], b: { id: string }[]) => a.length === b.length && a.every((x, i) => x.id === b[i]?.id);

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

const fakeSave = () => new Promise((resolve) => setTimeout(resolve, 450));

export function ExpenseSettingsTab({ drivers, vehicles, rates, onSaveDrivers, onSaveVehicles, onSaveRates }: ExpenseSettingsTabProps) {
  const [driverDraft, setDriverDraft] = useState<Driver[]>(drivers);
  const [newDriver, setNewDriver] = useState("");
  const [savingDrivers, setSavingDrivers] = useState(false);

  const [vehicleDraft, setVehicleDraft] = useState<Vehicle[]>(vehicles);
  const [newVehicle, setNewVehicle] = useState<{ name: string; fuelType: FuelType; ownership: VehicleOwnership }>({
    name: "",
    fuelType: "Petrol",
    ownership: "personal",
  });
  const [savingVehicles, setSavingVehicles] = useState(false);

  const [perKm, setPerKm] = useState(String(rates.perKm));
  const [passengerPerKm, setPassengerPerKm] = useState(String(rates.passengerPerKm));
  const [rateError, setRateError] = useState("");
  const [savingRates, setSavingRates] = useState(false);

  const driversDirty = !sameIds(driverDraft, drivers);
  const vehiclesDirty = !sameIds(vehicleDraft, vehicles);
  const ratesDirty = Number(perKm) !== rates.perKm || Number(passengerPerKm) !== rates.passengerPerKm;

  const addDriver = () => {
    const name = newDriver.trim();
    if (!name) return;
    if (driverDraft.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      showToast(`${name} is already a driver.`, "warning");
      return;
    }
    setDriverDraft((prev) => [...prev, { id: mockId("d"), name }]);
    setNewDriver("");
  };

  const addVehicle = () => {
    const name = newVehicle.name.trim();
    if (!name) return;
    setVehicleDraft((prev) => [...prev, { id: mockId("v"), name, fuelType: newVehicle.fuelType, ownership: newVehicle.ownership }]);
    setNewVehicle({ name: "", fuelType: "Petrol", ownership: "personal" });
  };

  const saveDrivers = async () => {
    setSavingDrivers(true);
    await fakeSave();
    onSaveDrivers(driverDraft);
    setSavingDrivers(false);
    notifyBackendPending("Save drivers");
    showToast("Drivers saved.", "success");
  };

  const saveVehicles = async () => {
    setSavingVehicles(true);
    await fakeSave();
    onSaveVehicles(vehicleDraft);
    setSavingVehicles(false);
    notifyBackendPending("Save vehicles");
    showToast("Vehicles saved.", "success");
  };

  const saveRates = async () => {
    const a = Number(perKm);
    const b = Number(passengerPerKm);
    if (!perKm.trim() || Number.isNaN(a) || a <= 0) return setRateError("Enter a per-km rate above zero.");
    if (!passengerPerKm.trim() || Number.isNaN(b) || b < 0) return setRateError("Enter a passenger rate of zero or more.");
    setRateError("");
    setSavingRates(true);
    await fakeSave();
    onSaveRates({ perKm: a, passengerPerKm: b });
    setSavingRates(false);
    notifyBackendPending("Save rates");
    showToast("Mileage rates saved — new journeys use them from now on.", "success");
  };

  return (
    <div className="mt-[var(--space-md)] grid grid-cols-1 gap-[var(--space-md)] lg:grid-cols-2">
      <SectionCard
        title="Drivers"
        description="People who can log journeys. Each driver is paid back through a bill in their name."
        footer={
          <Button size="sm" onClick={saveDrivers} loading={savingDrivers} disabled={!driversDirty || savingDrivers}>
            {beLabel("Save")}
          </Button>
        }
      >
        <div className="flex flex-col gap-[var(--space-sm)]">
          {driverDraft.length === 0 && <p className="text-body-sm text-content-secondary">No drivers yet — add the first one below.</p>}
          {driverDraft.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-[var(--space-sm)] rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
              <span className="truncate text-body-sm font-semibold text-content-primary">{d.name}</span>
              <button
                type="button"
                aria-label={`Remove ${d.name}`}
                onClick={() => setDriverDraft((prev) => prev.filter((x) => x.id !== d.id))}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-error hover:bg-error/10"
              >
                <Trash2 size={16} strokeWidth={2.25} />
              </button>
            </div>
          ))}
          <div className="flex items-end gap-[var(--space-sm)]">
            <div className="min-w-0 flex-1">
              <TextInput
                label="Add driver"
                placeholder="Full name"
                value={newDriver}
                onChange={(e) => setNewDriver(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addDriver()}
              />
            </div>
            <Button variant="outline" size="md" onClick={addDriver} disabled={!newDriver.trim()} aria-label="Add driver">
              <Plus size={18} strokeWidth={2.5} />
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Vehicles"
        description="Vehicles drivers can claim for. Fuel type and ownership decide which rate applies."
        footer={
          <Button size="sm" onClick={saveVehicles} loading={savingVehicles} disabled={!vehiclesDirty || savingVehicles}>
            {beLabel("Save")}
          </Button>
        }
      >
        <div className="flex flex-col gap-[var(--space-sm)]">
          {vehicleDraft.length === 0 && <p className="text-body-sm text-content-secondary">No vehicles yet — add one below.</p>}
          {vehicleDraft.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-[var(--space-sm)] rounded-md border border-border bg-page px-[var(--space-md)] py-[var(--space-sm)]">
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-content-primary">{v.name}</span>
                <span className="mt-[var(--space-xs)] flex flex-wrap gap-[var(--space-xs)]">
                  <Badge variant="neutral">{v.fuelType}</Badge>
                  <Badge variant="neutral">{v.ownership === "company" ? "Company" : "Personal"}</Badge>
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${v.name}`}
                onClick={() => setVehicleDraft((prev) => prev.filter((x) => x.id !== v.id))}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-error hover:bg-error/10"
              >
                <Trash2 size={16} strokeWidth={2.25} />
              </button>
            </div>
          ))}
          <div className="flex flex-col gap-[var(--space-sm)] rounded-md border border-dashed border-border p-[var(--space-sm)]">
            <TextInput
              label="Add vehicle"
              placeholder="e.g. Grey Transit van"
              value={newVehicle.name}
              onChange={(e) => setNewVehicle((n) => ({ ...n, name: e.target.value }))}
            />
            <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
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
        </div>
      </SectionCard>

      <SectionCard
        title="Mileage rates"
        description="Applied to every new journey. Existing journeys keep the rate they were created with."
        footer={
          <Button size="sm" onClick={saveRates} loading={savingRates} disabled={!ratesDirty || savingRates}>
            {beLabel("Save rates")}
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
          <TextInput label="Rate per km" inputMode="decimal" value={perKm} onChange={(e) => setPerKm(e.target.value)} />
          <TextInput label="Passenger rate per km" inputMode="decimal" value={passengerPerKm} onChange={(e) => setPassengerPerKm(e.target.value)} />
        </div>
        <p className="mt-[var(--space-sm)] text-caption text-content-secondary">
          Example: a 50 km journey with a passenger pays{" "}
          {money(50 * ((Number(perKm) || 0) + (Number(passengerPerKm) || 0)))}.
        </p>
        {rateError && <p className="mt-[var(--space-xs)] text-caption font-semibold text-status-danger-text">{rateError}</p>}
      </SectionCard>

      <SectionCard title="Who can do what" description="Claim permissions are set per team member on the Team page.">
        <div className="flex flex-col gap-[var(--space-sm)] text-body-sm text-content-secondary">
          <div className="flex items-start gap-[var(--space-sm)]">
            <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
            <p>
              <span className="font-semibold text-content-primary">Submitters</span> can create claims and journeys and see only their own.
              Good for employees who just send in receipts.
            </p>
          </div>
          <div className="flex items-start gap-[var(--space-sm)]">
            <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-content-muted" />
            <p>
              <span className="font-semibold text-content-primary">Approvers</span> see every claim, approve or remove receipts, publish to
              your accounting software and reimburse.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
