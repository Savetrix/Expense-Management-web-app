"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { PageHeader, Tabs } from "@/components/v2/ui";

import { ClaimsTab } from "./ClaimsTab";
import { ExpenseSettingsTab } from "./ExpenseSettingsTab";
import { MileageTab } from "./MileageTab";
import {
  MOCK_CLAIMS,
  MOCK_CONTACTS,
  MOCK_DRIVERS,
  MOCK_JOURNEYS,
  MOCK_RATES,
  MOCK_UNPOSTED_RECEIPTS,
  type ClaimReceipt,
  type Contact,
  type Driver,
  type ExpenseClaim,
  type Journey,
  type MileageRates,
  type Vehicle,
  MOCK_VEHICLES,
} from "./mockData";
import { NewClaimWizard } from "./NewClaimWizard";

type TopTab = "claims" | "mileage" | "settings";

// Front-end-only flow: all state lives here, seeded from mockData.ts, so moves
// between tabs (a vehicle added on a journey shows in Settings, a receipt
// removed from a claim returns to the wizard's pool) stay consistent while
// there's no API behind it.
export function ExpenseClaimsContentV2() {
  const [tab, setTab] = useState<TopTab>("claims");
  const [claims, setClaims] = useState<ExpenseClaim[]>(MOCK_CLAIMS);
  const [unposted, setUnposted] = useState<ClaimReceipt[]>(MOCK_UNPOSTED_RECEIPTS);
  const [contacts, setContacts] = useState<Contact[]>(MOCK_CONTACTS);
  const [journeys, setJourneys] = useState<Journey[]>(MOCK_JOURNEYS);
  const [drivers, setDrivers] = useState<Driver[]>(MOCK_DRIVERS);
  const [vehicles, setVehicles] = useState<Vehicle[]>(MOCK_VEHICLES);
  const [rates, setRates] = useState<MileageRates>(MOCK_RATES);
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleCreateClaim = (claim: ExpenseClaim) => {
    const ids = new Set(claim.receipts.map((r) => r.id));
    setUnposted((prev) => prev.filter((r) => !ids.has(r.id)));
    setClaims((prev) => [claim, ...prev]);
    setTab("claims");
  };

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Expense Claims"
        subtitle="Reimburse employees for out-of-pocket receipts and business mileage."
        action={
          tab === "claims" ? (
            <Button size="sm" onClick={() => setWizardOpen(true)} className="shrink-0">
              <Plus size={16} strokeWidth={2.5} />
              New expense claim
            </Button>
          ) : undefined
        }
      />

      <div className="mt-[var(--space-lg)]">
        <Tabs
          items={[
            { value: "claims", label: "Claims", count: claims.length },
            { value: "mileage", label: "Mileage", count: journeys.length },
            { value: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as TopTab)}
        />
      </div>

      {tab === "claims" && (
        <ClaimsTab
          claims={claims}
          onChangeClaims={setClaims}
          onReturnReceipt={(r) => setUnposted((prev) => [r, ...prev])}
          onNewClaim={() => setWizardOpen(true)}
        />
      )}
      {tab === "mileage" && (
        <MileageTab
          journeys={journeys}
          onChangeJourneys={setJourneys}
          drivers={drivers}
          vehicles={vehicles}
          onAddVehicle={(v) => setVehicles((prev) => [...prev, v])}
          rates={rates}
        />
      )}
      {tab === "settings" && (
        <ExpenseSettingsTab
          drivers={drivers}
          vehicles={vehicles}
          rates={rates}
          onSaveDrivers={setDrivers}
          onSaveVehicles={setVehicles}
          onSaveRates={setRates}
        />
      )}

      <NewClaimWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        receipts={unposted}
        contacts={contacts}
        onAddContact={(c) => setContacts((prev) => [...prev, c])}
        onCreate={handleCreateClaim}
      />
    </div>
  );
}
