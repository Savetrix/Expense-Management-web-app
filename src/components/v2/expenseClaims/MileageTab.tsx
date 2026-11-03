"use client";

import { Car, ExternalLink, MapPin, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { DataTable, Modal, ModalDefinitionRow, SearchInput, SelectDropdown, TextInput } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import {
  FUEL_TYPES,
  VEHICLE_TYPES,
  addMileageVehicle,
  lookupDistance,
  createJourney,
  deleteJourney,
  publishJourney,
  type ExpenseSettingsDto,
  type FuelType,
  type JourneyDto,
  type VehicleOwnership,
  type VehicleType,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch } from "@/store/hooks";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { CARD_CLASS, FIELD_LABEL_CLASS, TOOLBAR_CLASS, errorMessage, isApprover, money, shortDate, todayIso, type CompanyRole } from "./shared";
import type { TeamPerson } from "./useTeamMembers";

interface MileageTabProps {
  journeys: JourneyDto[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  drivers: TeamPerson[];
  driversLoading: boolean;
  settings: ExpenseSettingsDto | null;
  role: CompanyRole;
  selfId: string;
  onOpenSettings: () => void;
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

const round2 = (n: number) => Math.round(n * 100) / 100;

export function MileageTab({ journeys, loading, error, onRetry, drivers, driversLoading, settings, role, selfId, onOpenSettings }: MileageTabProps) {
  const dispatch = useAppDispatch();
  const provider = useActiveProvider();
  const approver = isApprover(role);
  const vehicles = useMemo(() => settings?.vehicles ?? [], [settings]);
  // Submitters (contributors) log only their own journeys.
  const driverOptions = useMemo(() => (approver ? drivers : drivers.filter((d) => d.userId === selfId)), [approver, drivers, selfId]);

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<JourneyForm | null>(null);
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newVehicle, setNewVehicle] = useState<{ name: string; vehicleType: VehicleType; fuelType: FuelType; ownership: VehicleOwnership }>({
    name: "",
    vehicleType: "Car",
    fuelType: "Petrol",
    ownership: "personal",
  });
  const [calculating, setCalculating] = useState(false);
  // The route Google measured, shown under the distance it filled in.
  const [route, setRoute] = useState<{ from: string; to: string } | null>(null);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"publish" | "delete" | null>(null);

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase();
    if (!lower) return journeys;
    return journeys.filter((j) => [j.driver.name, j.start, j.end, j.purpose].some((v) => v.toLowerCase().includes(lower)));
  }, [journeys, search]);

  const detail = journeys.find((j) => j.id === detailId) ?? null;

  const selectedVehicle = form ? vehicles.find((v) => v.id === form.vehicleId) : undefined;
  const rate = selectedVehicle ? settings?.rates[selectedVehicle.vehicleType]?.[selectedVehicle.fuelType] ?? null : null;
  const vehicleLabel = (v: { vehicleType: VehicleType; fuelType: FuelType }) => `${v.fuelType.toLowerCase()} ${v.vehicleType.toLowerCase()}`;
  const passengerRate = settings?.passengerRate ?? 0;
  const km = form?.oneWayKm == null ? null : round2(form.oneWayKm * (form.returnTrip ? 2 : 1));
  const formAmount = km === null || rate === null ? null : round2(km * (rate + (form?.passenger ? passengerRate : 0)));

  const openForm = () => {
    setForm({
      driverId: driverOptions[0]?.userId ?? "",
      vehicleId: vehicles[0]?.id ?? ADD_VEHICLE,
      date: todayIso(),
      start: "",
      end: "",
      returnTrip: false,
      purpose: "",
      oneWayKm: null,
      passenger: false,
    });
    setFormError("");
    setRoute(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (creating) return;
    setFormOpen(false);
  };

  const patch = (p: Partial<JourneyForm>) => setForm((f) => (f ? { ...f, ...p } : f));

  const handleAddVehicle = async () => {
    if (!newVehicle.name.trim()) {
      setFormError("Give the vehicle a name.");
      return;
    }
    setFormError("");
    setAddingVehicle(true);
    const result = await dispatch(addMileageVehicle({ ...newVehicle, name: newVehicle.name.trim() }));
    setAddingVehicle(false);
    if (addMileageVehicle.fulfilled.match(result)) {
      patch({ vehicleId: result.payload.id });
      setNewVehicle({ name: "", vehicleType: "Car", fuelType: "Petrol", ownership: "personal" });
    } else {
      setFormError(errorMessage(result.payload, "Couldn't add the vehicle."));
    }
  };

  const handleCreate = async () => {
    if (!form) return;
    if (!form.driverId) return setFormError("Choose a driver.");
    if (!form.vehicleId || form.vehicleId === ADD_VEHICLE) return setFormError("Choose or add a vehicle.");
    if (!form.date) return setFormError("Pick the journey date.");
    if (!form.start.trim() || !form.end.trim()) return setFormError("Enter where the journey started and ended.");
    if (form.oneWayKm === null || form.oneWayKm <= 0) return setFormError("Enter the one-way distance.");
    if (rate === null) return setFormError(`Set a mileage rate for a ${selectedVehicle ? vehicleLabel(selectedVehicle) : "vehicle"} in Settings first.`);
    if (!form.purpose.trim()) return setFormError("Add a business purpose — it's required for the claim to be valid.");
    setFormError("");
    setCreating(true);
    const result = await dispatch(
      createJourney({
        driver: { userId: form.driverId },
        vehicleId: form.vehicleId,
        date: form.date,
        start: form.start.trim(),
        end: form.end.trim(),
        returnTrip: form.returnTrip,
        oneWayKm: form.oneWayKm,
        passenger: form.passenger,
        purpose: form.purpose.trim(),
      }),
    );
    setCreating(false);
    if (createJourney.fulfilled.match(result)) {
      setFormOpen(false);
      showToast(`Journey saved as a draft for ${result.payload.driver.name}.`, "success");
    } else {
      setFormError(errorMessage(result.payload, "Couldn't save the journey."));
    }
  };

  const handleCalculate = async () => {
    if (!form) return;
    if (!form.start.trim() || !form.end.trim()) {
      setFormError("Enter where the journey started and ended to calculate the distance.");
      return;
    }
    setFormError("");
    setCalculating(true);
    const result = await dispatch(lookupDistance({ from: form.start.trim(), to: form.end.trim() }));
    setCalculating(false);
    if (lookupDistance.fulfilled.match(result)) {
      patch({ oneWayKm: result.payload.km });
      setRoute({ from: result.payload.from, to: result.payload.to });
    } else {
      setRoute(null);
      setFormError(errorMessage(result.payload, "Couldn't calculate the distance — enter it yourself."));
    }
  };

  const handlePublish = async (journey: JourneyDto) => {
    setBusy("publish");
    const result = await dispatch(publishJourney(journey.id));
    setBusy(null);
    if (publishJourney.fulfilled.match(result)) {
      showToast(`Published to ${provider.name} as a bill payable to ${journey.driver.name}.`, "success");
    } else if (publishJourney.rejected.match(result)) {
      const payload = result.payload;
      showToast(errorMessage(payload, "Couldn't publish the journey."), "error");
      if (payload?.code === "MILEAGE_ACCOUNT_NOT_SET") {
        setDetailId(null);
        onOpenSettings();
      }
    }
  };

  const handleDelete = async (journey: JourneyDto) => {
    const ok = await confirmDialog({
      title: "Delete journey?",
      message:
        journey.status === "published"
          ? `This removes the journey here only — the bill already in ${provider.name} stays until you void it there.`
          : `The ${journey.km} km journey on ${shortDate(journey.date)} will be deleted.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy("delete");
    const result = await dispatch(deleteJourney(journey.id));
    setBusy(null);
    if (deleteJourney.fulfilled.match(result)) {
      setDetailId(null);
      showToast("Journey deleted.", "success");
    } else {
      showToast(errorMessage(result.payload, "Couldn't delete the journey."), "error");
    }
  };

  const canDelete = (j: JourneyDto) => approver || (j.createdBy === selfId && j.status === "draft");

  const columns: DataTableColumn<JourneyDto>[] = [
    { key: "date", header: "Date", width: "12%", render: (j) => <span className="block truncate">{shortDate(j.date)}</span> },
    { key: "driver", header: "Driver", width: "15%", render: (j) => <span className="block truncate font-bold">{j.driver.name}</span> },
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
    { key: "amount", header: "Amount", width: "12%", align: "right", render: (j) => <span className="font-bold">{money(j.amount)}</span> },
    { key: "purpose", header: "Purpose", width: "12%", render: (j) => <span className="block truncate text-content-secondary">{j.purpose}</span> },
    {
      key: "status",
      header: "Status",
      width: "10%",
      align: "right",
      render: (j) => <Badge variant={j.status === "published" ? "success" : "neutral"}>{j.status === "published" ? "Published" : "Draft"}</Badge>,
    },
  ];

  const noRatesYet = !!settings && VEHICLE_TYPES.every((t) => FUEL_TYPES.every((f) => settings.rates[t]?.[f] == null));

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
          <Button size="sm" onClick={openForm} className="shrink-0" disabled={driverOptions.length === 0 || driversLoading || !settings}>
            <Plus size={16} strokeWidth={2.5} />
            Journey
          </Button>
        </div>

        {noRatesYet && (
          <div className="border-b border-border bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-content-secondary">
            No mileage rates yet.{" "}
            <button type="button" onClick={onOpenSettings} className="font-bold text-accent hover:underline">
              Set them in Settings
            </button>{" "}
            before logging a journey.
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-[var(--space-xl)]">
            <Spinner />
          </div>
        ) : error && journeys.length === 0 ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : journeys.length === 0 ? (
          <EmptyState
            icon={<Car size={28} strokeWidth={1.75} />}
            title={driverOptions.length === 0 ? (driversLoading ? "Loading team members…" : "No team members yet") : "No journeys yet"}
            description={
              driverOptions.length === 0
                ? "Drivers are your team members. Invite people on the Team page, then log business journeys here."
                : "Log a business journey and the amount is worked out from your mileage rate for the vehicle's fuel type."
            }
            actionLabel={driverOptions.length > 0 && settings ? "Add a journey" : undefined}
            onAction={driverOptions.length > 0 && settings ? openForm : undefined}
          />
        ) : visible.length === 0 ? (
          <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">No journeys match &quot;{search}&quot;.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <DataTable
                columns={columns}
                rows={visible}
                getRowKey={(j) => j.id}
                onRowClick={(j) => setDetailId(j.id)}
                bordered={false}
                maxHeightClassName="max-h-[560px]"
              />
            </div>
          </div>
        )}
      </div>

      {/* New journey */}
      <Modal
        open={formOpen && !!form}
        onClose={closeForm}
        title="New journey"
        widthClassName="max-w-lg"
        footer={
          <div className="flex w-full items-center justify-between gap-[var(--space-sm)]">
            <Button variant="outline" size="sm" onClick={closeForm} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} loading={creating} disabled={creating || addingVehicle}>
              Save as draft
            </Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <SelectDropdown label="Driver *" value={form.driverId} onChange={(e) => patch({ driverId: e.target.value })} disabled={!approver}>
              {driverOptions.map((d) => (
                <option key={d.userId} value={d.userId}>
                  {d.name}
                </option>
              ))}
            </SelectDropdown>

            <SelectDropdown label="Vehicle *" value={form.vehicleId} onChange={(e) => patch({ vehicleId: e.target.value })}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.vehicleType} · {v.fuelType} · {v.ownership === "company" ? "Company" : "Personal"}
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
                  label="Vehicle type"
                  value={newVehicle.vehicleType}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, vehicleType: e.target.value as VehicleType }))}
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
                  Add vehicle
                </Button>
              </div>
            )}

            <TextInput label="Date *" type="date" value={form.date} onChange={(e) => patch({ date: e.target.value })} />

            <div className="grid grid-cols-1 gap-[var(--space-sm)] sm:grid-cols-2">
              <TextInput
                label="From *"
                placeholder="Postal code or address"
                value={form.start}
                onChange={(e) => patch({ start: e.target.value })}
              />
              <TextInput label="To *" placeholder="Postal code or address" value={form.end} onChange={(e) => patch({ end: e.target.value })} />
            </div>

            <Button variant="outline" size="sm" onClick={handleCalculate} loading={calculating} disabled={calculating}>
              <MapPin size={16} strokeWidth={2.25} />
              Calculate distance
            </Button>

            <TextInput
              label="One-way distance (km) *"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="e.g. 21.5"
              value={form.oneWayKm === null ? "" : String(form.oneWayKm)}
              onChange={(e) => {
                const value = e.target.value;
                const parsed = Number(value);
                patch({ oneWayKm: value === "" || Number.isNaN(parsed) || parsed < 0 ? null : parsed });
                setRoute(null);
              }}
            />
            {route && (
              <p className="-mt-[var(--space-sm)] text-caption text-content-secondary">
                Driving distance from {route.from} to {route.to}. You can still change it.
              </p>
            )}

            <div className="flex items-center justify-between gap-[var(--space-md)]">
              <div>
                <p className={FIELD_LABEL_CLASS}>Return trip</p>
                <p className="text-caption text-content-secondary">Doubles the distance for there and back.</p>
              </div>
              <Switch checked={form.returnTrip} onChange={(v) => patch({ returnTrip: v })} label="Return trip" />
            </div>

            <TextInput
              label="Business purpose *"
              placeholder="e.g. Client meeting"
              value={form.purpose}
              onChange={(e) => patch({ purpose: e.target.value })}
            />

            <div className="flex items-center justify-between gap-[var(--space-md)]">
              <div>
                <p className={FIELD_LABEL_CLASS}>Carrying a passenger</p>
                <p className="text-caption text-content-secondary">
                  Adds {settings?.passengerRate == null ? "the passenger rate set in Settings" : `${money(settings.passengerRate)} per km`}.
                </p>
              </div>
              <Switch checked={form.passenger} onChange={(v) => patch({ passenger: v })} label="Carrying a passenger" />
            </div>

            <div className="rounded-md bg-surface-alt px-[var(--space-md)] py-[var(--space-sm)]">
              {selectedVehicle && rate === null ? (
                <p className="text-body-sm text-content-secondary">No rate for a {vehicleLabel(selectedVehicle)} yet — set one in Settings.</p>
              ) : km === null || formAmount === null || rate === null ? (
                <p className="text-body-sm text-content-secondary">Enter the distance to see the claim amount.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-body-sm text-content-secondary">
                    <span>
                      {km.toLocaleString("en-US")} km × {money(rate + (form.passenger ? passengerRate : 0))}
                      {form.returnTrip ? " (return)" : ""}
                    </span>
                    {selectedVehicle && (
                      <span>
                        {selectedVehicle.vehicleType} · {selectedVehicle.fuelType}
                      </span>
                    )}
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
        )}
      </Modal>

      {/* Journey detail */}
      <Modal
        open={!!detail}
        onClose={() => !busy && setDetailId(null)}
        title="Journey"
        footer={
          detail ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-[var(--space-sm)]">
              {canDelete(detail) ? (
                <button
                  type="button"
                  onClick={() => handleDelete(detail)}
                  disabled={!!busy}
                  className="inline-flex items-center gap-[var(--space-xs)] rounded-pill px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-bold text-error hover:bg-error/10 disabled:opacity-60"
                >
                  <Trash2 size={16} strokeWidth={2.25} />
                  Delete
                </button>
              ) : (
                <span />
              )}
              {detail.status === "draft" && approver ? (
                <Button size="sm" onClick={() => handlePublish(detail)} loading={busy === "publish"} disabled={!!busy}>
                  Publish as bill to driver
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setDetailId(null)} disabled={!!busy}>
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
            <ModalDefinitionRow label="Driver">{detail.driver.name}</ModalDefinitionRow>
            <ModalDefinitionRow label="Vehicle">
              {detail.vehicle.name} · {detail.vehicle.vehicleType ?? "Car"} · {detail.vehicle.fuelType}
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
              {detail.status === "published" && detail.billUrl ? (
                <a
                  href={detail.billUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-[var(--space-xs)] font-semibold text-accent hover:underline"
                >
                  Published {shortDate(detail.publishedAt)}
                  <ExternalLink size={14} strokeWidth={2.25} />
                </a>
              ) : (
                <Badge variant={detail.status === "published" ? "success" : "neutral"}>{detail.status === "published" ? "Published" : "Draft"}</Badge>
              )}
            </ModalDefinitionRow>
            <ModalDefinitionRow label="Amount">{money(detail.amount)}</ModalDefinitionRow>
            {detail.status === "draft" && (
              <p className="mt-[var(--space-sm)] text-caption text-content-secondary">
                {approver
                  ? `Publishing creates a bill in ${provider.name} payable to the driver, so the reimbursement shows in your payables.`
                  : "Someone with approval rights publishes it as a bill payable to you."}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
