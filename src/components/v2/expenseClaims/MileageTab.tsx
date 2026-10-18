"use client";

import { Car, MapPin, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { DataTable, Modal, ModalDefinitionRow, SearchInput, SelectDropdown, TextInput } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { beLabel, notifyBackendPending } from "@/lib/bePlaceholder";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { CARD_CLASS, FIELD_LABEL_CLASS, TOOLBAR_CLASS, journeyAmount, localId, money, shortDate, todayIso } from "./shared";
import { FUEL_TYPES, type FuelType, type Journey, type MileageRates, type Vehicle, type VehicleOwnership } from "./types";
import type { TeamPerson } from "./useTeamMembers";

interface MileageTabProps {
  journeys: Journey[];
  onChangeJourneys: (updater: (prev: Journey[]) => Journey[]) => void;
  drivers: TeamPerson[];
  driversLoading: boolean;
  vehicles: Vehicle[];
  onAddVehicle: (vehicle: Vehicle) => void;
  rates: MileageRates;
}

const ADD_VEHICLE = "__add__";

interface JourneyForm {
  driverId: string;
  vehicleId: string;
  date: string;
  start: string;
  end: string;
  returnTrip: boolean;
  purpose: string;
  oneWayKm: number | null;
  passenger: boolean;
}

const emptyForm = (drivers: TeamPerson[], vehicles: Vehicle[]): JourneyForm => ({
  driverId: drivers[0]?.id ?? "",
  vehicleId: vehicles[0]?.id ?? ADD_VEHICLE,
  date: todayIso(),
  start: "",
  end: "",
  returnTrip: false,
  purpose: "",
  oneWayKm: null,
  passenger: false,
});

export function MileageTab({ journeys, onChangeJourneys, drivers, driversLoading, vehicles, onAddVehicle, rates }: MileageTabProps) {
  const provider = useActiveProvider();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<JourneyForm>(() => emptyForm(drivers, vehicles));
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newVehicle, setNewVehicle] = useState<{ name: string; fuelType: FuelType; ownership: VehicleOwnership }>({
    name: "",
    fuelType: "Petrol",
    ownership: "personal",
  });
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const driverName = (id: string) => drivers.find((d) => d.id === id)?.name ?? journeys.find((j) => j.driverId === id)?.driverName ?? "Unknown driver";
  const vehicleOf = (id: string) => vehicles.find((v) => v.id === id);

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase();
    const sorted = [...journeys].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!lower) return sorted;
    return sorted.filter((j) =>
      [j.driverName, j.start, j.end, j.purpose].some((v) => v.toLowerCase().includes(lower)),
    );
  }, [journeys, search]);

  const detail = journeys.find((j) => j.id === detailId) ?? null;

  const km = form.oneWayKm === null ? null : form.oneWayKm * (form.returnTrip ? 2 : 1);
  const passengerRate = rates.passengerPerKm ?? 0;
  const formAmount =
    km === null || rates.perKm === null ? null : journeyAmount({ km, rate: rates.perKm, passenger: form.passenger, passengerRate });

  const openForm = () => {
    setForm(emptyForm(drivers, vehicles));
    setFormError("");
    setFormOpen(true);
  };

  const closeForm = () => {
    if (creating) return;
    setFormOpen(false);
  };

  const patch = (p: Partial<JourneyForm>) => setForm((f) => ({ ...f, ...p }));

  const handleCalculate = async () => {
    if (!form.start.trim() || !form.end.trim()) {
      setFormError("Enter both a start and an end postal code to calculate the distance.");
      return;
    }
    setFormError("");
    // No routing service yet: nothing is filled in. The distance is typed below.
    notifyBackendPending("Calculate distance");
  };

  const handleAddVehicle = async () => {
    if (!newVehicle.name.trim()) {
      setFormError("Give the vehicle a name.");
      return;
    }
    setFormError("");
    setAddingVehicle(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const vehicle: Vehicle = { id: localId("v"), name: newVehicle.name.trim(), fuelType: newVehicle.fuelType, ownership: newVehicle.ownership };
    onAddVehicle(vehicle);
    patch({ vehicleId: vehicle.id });
    setNewVehicle({ name: "", fuelType: "Petrol", ownership: "personal" });
    setAddingVehicle(false);
    notifyBackendPending("Add vehicle");
  };

  const handleCreate = async () => {
    if (!form.driverId) return setFormError("Choose a driver.");
    if (!form.vehicleId || form.vehicleId === ADD_VEHICLE) return setFormError("Choose or add a vehicle.");
    if (!form.date) return setFormError("Pick the journey date.");
    if (km === null) return setFormError("Enter the distance before creating the journey.");
    if (rates.perKm === null) return setFormError("Set a mileage rate in Settings before creating a journey.");
    if (!form.purpose.trim()) return setFormError("Add a business purpose — it's required for the claim to be valid.");
    setFormError("");
    setCreating(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const journey: Journey = {
      id: localId("j"),
      driverName: driverName(form.driverId),
      date: form.date,
      driverId: form.driverId,
      vehicleId: form.vehicleId,
      start: form.start.trim().toUpperCase(),
      end: form.end.trim().toUpperCase(),
      returnTrip: form.returnTrip,
      km,
      rate: rates.perKm,
      passenger: form.passenger,
      passengerRate,
      purpose: form.purpose.trim(),
      status: "Draft",
    };
    onChangeJourneys((prev) => [journey, ...prev]);
    setCreating(false);
    setFormOpen(false);
    notifyBackendPending("Create journey");
    showToast(`Journey saved as a draft for ${journey.driverName}.`, "success");
  };

  const handlePublish = async (journey: Journey) => {
    setPublishing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    onChangeJourneys((prev) => prev.map((j) => (j.id === journey.id ? { ...j, status: "Published" } : j)));
    setPublishing(false);
    notifyBackendPending("Publish as bill to driver");
    showToast(`Published to ${provider.name} as a bill payable to ${journey.driverName}.`, "success");
  };

  const handleDelete = async (journey: Journey) => {
    const ok = await confirmDialog({
      title: "Delete journey?",
      message:
        journey.status === "Published"
          ? `This removes the journey here only — the bill already in ${provider.name} stays until you void it there.`
          : `The ${journey.km} km journey on ${shortDate(journey.date)} will be deleted.`,
      confirmLabel: beLabel("Delete"),
      tone: "destructive",
    });
    if (!ok) return;
    onChangeJourneys((prev) => prev.filter((j) => j.id !== journey.id));
    setDetailId(null);
    notifyBackendPending("Delete journey");
  };

  const columns: DataTableColumn<Journey>[] = [
    { key: "date", header: "Date", width: "12%", render: (j) => <span className="block truncate">{shortDate(j.date)}</span> },
    { key: "driver", header: "Driver", width: "15%", render: (j) => <span className="block truncate font-bold">{j.driverName}</span> },
    {
      key: "route",
      header: "Route",
      width: "22%",
      render: (j) => (
        <span className="block truncate text-content-secondary">
          {j.start} → {j.end}
          {j.returnTrip ? " ↺" : ""}
        </span>
      ),
    },
    { key: "km", header: "km", width: "8%", align: "right", render: (j) => j.km.toLocaleString("en-US") },
    { key: "rate", header: "Rate", width: "9%", align: "right", render: (j) => money(j.rate + (j.passenger ? j.passengerRate : 0)) },
    { key: "amount", header: "Amount", width: "12%", align: "right", render: (j) => <span className="font-bold">{money(journeyAmount(j))}</span> },
    { key: "purpose", header: "Purpose", width: "12%", render: (j) => <span className="block truncate text-content-secondary">{j.purpose}</span> },
    {
      key: "status",
      header: "Status",
      width: "10%",
      align: "right",
      render: (j) => <Badge variant={j.status === "Published" ? "success" : "neutral"}>{j.status}</Badge>,
    },
  ];

  const selectedVehicle = vehicleOf(form.vehicleId);

  return (
    <>
      <div className={`mt-[var(--space-md)] ${CARD_CLASS}`}>
        <div className={`${TOOLBAR_CLASS} lg:justify-between`}>
          {journeys.length > 0 ? (
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search driver, route or purpose…"
              widthClassName="w-full lg:w-96"
            />
          ) : (
            <p className="text-body-sm text-content-secondary">Business journeys logged by your drivers.</p>
          )}
          <Button size="sm" onClick={openForm} className="shrink-0" disabled={drivers.length === 0 || driversLoading}>
            <Plus size={16} strokeWidth={2.5} />
            Journey
          </Button>
        </div>

        {journeys.length === 0 ? (
          <EmptyState
            icon={<Car size={28} strokeWidth={1.75} />}
            title={drivers.length === 0 ? (driversLoading ? "Loading team members…" : "No team members yet") : "No journeys yet"}
            description={
              drivers.length === 0
                ? "Drivers are your team members. Invite people on the Team page, then log business journeys here."
                : "Log a business journey and the distance and amount are worked out for you from your mileage rates."
            }
            actionLabel={drivers.length > 0 ? "Add a journey" : undefined}
            onAction={drivers.length > 0 ? openForm : undefined}
          />
        ) : visible.length === 0 ? (
          <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No journeys match &quot;{search}&quot;.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <DataTable columns={columns} rows={visible} getRowKey={(j) => j.id} onRowClick={(j) => setDetailId(j.id)} bordered={false} maxHeightClassName="max-h-[560px]" />
            </div>
          </div>
        )}
      </div>

      {/* New journey */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title="New journey"
        widthClassName="max-w-lg"
        footer={
          <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
            <Button variant="outline" size="sm" onClick={closeForm} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} loading={creating} disabled={creating}>
              {beLabel("Create journey")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-[var(--space-md)]">
          <SelectDropdown label="Driver *" value={form.driverId} onChange={(e) => patch({ driverId: e.target.value })}>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectDropdown>

          <SelectDropdown label="Vehicle *" value={form.vehicleId} onChange={(e) => patch({ vehicleId: e.target.value })}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.fuelType} · {v.ownership === "company" ? "Company" : "Personal"}
              </option>
            ))}
            <option value={ADD_VEHICLE}>+ Add a vehicle</option>
          </SelectDropdown>

          {form.vehicleId === ADD_VEHICLE && (
            <div className="flex flex-col gap-[var(--space-sm)] rounded-md border border-border bg-page p-[var(--space-md)]">
              <p className="text-body-sm font-semibold text-content-primary">Add a vehicle</p>
              <TextInput
                label="Vehicle name"
                placeholder="e.g. Blue Civic"
                value={newVehicle.name}
                onChange={(e) => setNewVehicle((v) => ({ ...v, name: e.target.value }))}
              />
              <SelectDropdown
                label="Fuel type"
                value={newVehicle.fuelType}
                onChange={(e) => setNewVehicle((v) => ({ ...v, fuelType: e.target.value as FuelType }))}
              >
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </SelectDropdown>
              <div>
                <span className={FIELD_LABEL_CLASS}>Owned by</span>
                <div className="mt-[var(--space-xs)] flex flex-wrap gap-[var(--space-md)] text-body-sm text-content-primary">
                  {(["personal", "company"] as VehicleOwnership[]).map((o) => (
                    <label key={o} className="flex items-center gap-[var(--space-xs)]">
                      <input
                        type="radio"
                        name="vehicle-ownership"
                        checked={newVehicle.ownership === o}
                        onChange={() => setNewVehicle((v) => ({ ...v, ownership: o }))}
                      />
                      {o === "personal" ? "Personal (employee's own)" : "Company"}
                    </label>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddVehicle} loading={addingVehicle} disabled={addingVehicle}>
                {beLabel("Add vehicle")}
              </Button>
            </div>
          )}

          <TextInput label="Date *" type="date" value={form.date} onChange={(e) => patch({ date: e.target.value })} />

          <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
            <TextInput
              label="Start postal code *"
              placeholder="e.g. M5V 2T6"
              value={form.start}
              onChange={(e) => patch({ start: e.target.value })}
            />
            <TextInput
              label="End postal code *"
              placeholder="e.g. L5B 3C2"
              value={form.end}
              onChange={(e) => patch({ end: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between gap-[var(--space-md)]">
            <div>
              <p className={FIELD_LABEL_CLASS}>Return trip</p>
              <p className="text-caption text-content-secondary">Doubles the distance for there and back.</p>
            </div>
            <Switch checked={form.returnTrip} onChange={(v) => patch({ returnTrip: v })} label="Return trip" />
          </div>

          <Button variant="outline" size="sm" onClick={handleCalculate}>
            <MapPin size={16} strokeWidth={2.25} />
            {beLabel("Calculate distance")}
          </Button>

          <TextInput
            label="One-way distance (km) *"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="Enter the distance until it can be calculated"
            value={form.oneWayKm === null ? "" : String(form.oneWayKm)}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = Number(value);
              patch({ oneWayKm: value === "" || Number.isNaN(parsed) || parsed < 0 ? null : parsed });
            }}
          />

          <TextInput
            label="Business purpose *"
            placeholder="e.g. Client meeting"
            value={form.purpose}
            onChange={(e) => patch({ purpose: e.target.value })}
          />

          <div className="flex items-center justify-between gap-[var(--space-md)]">
            <div>
              <p className={FIELD_LABEL_CLASS}>Carrying a passenger</p>
              <p className="text-caption text-content-secondary">Adds {rates.passengerPerKm === null ? "the passenger rate you set in Settings" : `${money(rates.passengerPerKm)} per km`}.</p>
            </div>
            <Switch checked={form.passenger} onChange={(v) => patch({ passenger: v })} label="Carrying a passenger" />
          </div>

          <div className="rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]">
            {km === null ? (
              <p className="text-body-sm text-content-secondary">Enter the distance to see the claim amount.</p>
            ) : rates.perKm === null || formAmount === null ? (
              <p className="text-body-sm text-content-secondary">Set a mileage rate in Settings</p>
            ) : (
              <>
                <div className="flex items-center justify-between text-body-sm text-content-secondary">
                  <span>
                    {km.toLocaleString("en-US")} km × {money(rates.perKm + (form.passenger ? passengerRate : 0))}
                    {form.returnTrip ? " (return)" : ""}
                  </span>
                  {selectedVehicle && <span>{selectedVehicle.fuelType}</span>}
                </div>
                <div className="mt-[var(--space-xs)] flex items-center justify-between text-body font-bold text-content-primary">
                  <span>Amount</span>
                  <span>{money(formAmount)}</span>
                </div>
              </>
            )}
          </div>

          {formError && <p className="text-caption font-semibold text-status-danger-text">{formError}</p>}
        </div>
      </Modal>

      {/* Journey detail */}
      <Modal
        open={!!detail}
        onClose={() => !publishing && setDetailId(null)}
        title="Journey"
        footer={
          detail ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-[var(--space-sm)]">
              <button
                type="button"
                onClick={() => handleDelete(detail)}
                disabled={publishing}
                className="inline-flex items-center gap-[var(--space-xs)] rounded-pill px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-bold text-error hover:bg-error/10 disabled:opacity-60"
              >
                <Trash2 size={16} strokeWidth={2.25} />
                Delete
              </button>
              {detail.status === "Draft" ? (
                <Button size="sm" onClick={() => handlePublish(detail)} loading={publishing} disabled={publishing}>
                  {beLabel("Publish as bill to driver")}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setDetailId(null)}>
                  Close
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {detail && (
          <div>
            <ModalDefinitionRow label="Date">{shortDate(detail.date)}</ModalDefinitionRow>
            <ModalDefinitionRow label="Driver">{detail.driverName}</ModalDefinitionRow>
            <ModalDefinitionRow label="Vehicle">
              {vehicleOf(detail.vehicleId) ? `${vehicleOf(detail.vehicleId)?.name} · ${vehicleOf(detail.vehicleId)?.fuelType}` : "—"}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Route">
              {detail.start} → {detail.end}
              {detail.returnTrip ? " (return)" : ""}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Distance">{detail.km.toLocaleString("en-US")} km</ModalDefinitionRow>
            <ModalDefinitionRow label="Rate">
              {money(detail.rate)}/km{detail.passenger ? ` + ${money(detail.passengerRate)}/km passenger` : ""}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Purpose">
              <span className="truncate">{detail.purpose}</span>
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Status">
              <Badge variant={detail.status === "Published" ? "success" : "neutral"}>{detail.status}</Badge>
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Amount">{money(journeyAmount(detail))}</ModalDefinitionRow>
            {detail.status === "Draft" && (
              <p className="mt-[var(--space-sm)] text-caption text-content-secondary">
                Publishing creates a bill in {provider.name} payable to the driver, so the reimbursement shows in your payables.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
