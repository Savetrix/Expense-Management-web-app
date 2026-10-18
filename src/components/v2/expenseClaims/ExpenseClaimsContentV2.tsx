"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { PageHeader, Tabs } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";

import { ClaimsTab } from "./ClaimsTab";
import { ExpenseSettingsTab } from "./ExpenseSettingsTab";
import { MileageTab } from "./MileageTab";
import { NewClaimWizard } from "./NewClaimWizard";
import type { ClaimReceipt, ExpenseClaim, Journey, MileageRates, Vehicle } from "./types";
import { useTeamMembers } from "./useTeamMembers";

type TopTab = "claims" | "mileage" | "settings";

// Claims, journeys, vehicles and rates have no API yet, so they live here in
// local state and start empty. Receipts come from the real pending invoices
// and drivers/claimants from the real team members.
export function ExpenseClaimsContentV2() {
  const dispatch = useAppDispatch();
  const { members, loading: membersLoading, error: membersError } = useTeamMembers();
  const { invoices, pendingInvoices, loading: invoicesLoading } = useAppSelector((state) => state.invoice);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);

  const [tab, setTab] = useState<TopTab>("claims");
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  // Receipts taken off a claim (or already on one) are tracked by invoice id.
  const [usedIds, setUsedIds] = useState<Set<string>>(new Set());
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rates, setRates] = useState<MileageRates>({ perKm: null, passengerPerKm: null });
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (qbConnectionId && invoices.length === 0 && !invoicesLoading) dispatch(getInvoices());
    // Mount / company change only — re-running on the list would loop on an empty account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbConnectionId]);

  const receipts = useMemo<ClaimReceipt[]>(
    () =>
      pendingInvoices
        .filter((inv) => !usedIds.has(inv._id))
        .map((inv) => ({
          id: inv._id,
          vendor: inv.extractedData?.vendorName || "Unknown vendor",
          date: inv.extractedData?.invoiceDate?.slice(0, 10) || "",
          tax: inv.extractedData?.taxAmount ?? 0,
          amount: inv.extractedData?.totalAmount ?? 0,
          currency: inv.extractedData?.currency,
        })),
    [pendingInvoices, usedIds],
  );

  const handleCreateClaim = (claim: ExpenseClaim) => {
    setUsedIds((prev) => new Set([...prev, ...claim.receipts.map((r) => r.id)]));
    setClaims((prev) => [claim, ...prev]);
    setTab("claims");
  };

  const handleReturnReceipt = (r: ClaimReceipt) =>
    setUsedIds((prev) => {
      const next = new Set(prev);
      next.delete(r.id);
      return next;
    });

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
          onReturnReceipt={handleReturnReceipt}
          onNewClaim={() => setWizardOpen(true)}
        />
      )}
      {tab === "mileage" && (
        <MileageTab
          journeys={journeys}
          onChangeJourneys={setJourneys}
          drivers={members}
          driversLoading={membersLoading}
          vehicles={vehicles}
          onAddVehicle={(v) => setVehicles((prev) => [...prev, v])}
          rates={rates}
        />
      )}
      {tab === "settings" && (
        <ExpenseSettingsTab
          members={members}
          membersLoading={membersLoading}
          membersError={membersError}
          vehicles={vehicles}
          rates={rates}
          onSaveVehicles={setVehicles}
          onSaveRates={setRates}
        />
      )}

      <NewClaimWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        receipts={receipts}
        loadingReceipts={invoicesLoading && invoices.length === 0}
        members={members}
        onCreate={handleCreateClaim}
      />
    </div>
  );
}
