"use client";

import { Plus, Receipt } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, Tabs } from "@/components/v2/ui";
import { fetchClaimContacts, fetchExpenseClaims, fetchExpenseSettings, fetchJourneys } from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";

import { ClaimsTab } from "./ClaimsTab";
import { ExpenseSettingsTab } from "./ExpenseSettingsTab";
import { MileageTab } from "./MileageTab";
import { NewClaimWizard, type WizardReceipt } from "./NewClaimWizard";
import { useTeamMembers } from "./useTeamMembers";

type TopTab = "claims" | "mileage" | "settings";

export function ExpenseClaimsContentV2() {
  const dispatch = useAppDispatch();
  const team = useTeamMembers();
  const { activeId } = team;
  const { invoices, pendingInvoices, loading: invoicesLoading } = useAppSelector((state) => state.invoice);
  const ec = useAppSelector((state) => state.expenseClaims);

  const [tab, setTab] = useState<TopTab>("claims");
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!activeId) return;
    dispatch(fetchExpenseClaims());
    dispatch(fetchJourneys());
    dispatch(fetchExpenseSettings());
    dispatch(fetchClaimContacts());
    // Receipts come from the invoice list; it's usually loaded already.
    if (invoices.length === 0 && !invoicesLoading) dispatch(getInvoices());
    // Mount / company change only — re-running on the list would loop on an empty account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // A list loaded for another company is treated as not loaded.
  const claims = ec.claimsConnectionId === activeId ? ec.claims : [];
  const journeys = ec.journeysConnectionId === activeId ? ec.journeys : [];
  const settings = ec.settingsConnectionId === activeId ? ec.settings : null;
  const contacts = ec.contactsConnectionId === activeId ? ec.contacts : [];

  // Pending receipts not already on a claim. Contributors only ever get their
  // own uploads from the invoice list, so they only see their own here.
  const receipts = useMemo<WizardReceipt[]>(
    () =>
      pendingInvoices
        .filter((inv) => !inv.expenseClaimId)
        .map((inv) => ({
          id: inv._id,
          vendor: inv.extractedData?.vendorName || "Unknown vendor",
          date: inv.extractedData?.invoiceDate?.slice(0, 10) || "",
          amount: inv.extractedData?.totalAmount ?? 0,
          currency: inv.extractedData?.currency ?? null,
        })),
    [pendingInvoices],
  );

  if (!team.hasCompany) {
    return (
      <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
        <PageHeader title="Expense Claims" subtitle="Reimburse employees for out-of-pocket receipts and business mileage." />
        <EmptyState
          icon={<Receipt size={28} strokeWidth={1.75} />}
          title="Pick a company"
          description="Choose a company in the header to see its expense claims."
        />
      </div>
    );
  }

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
          loading={ec.claimsLoading && ec.claimsConnectionId !== activeId}
          error={ec.claimsError}
          onRetry={() => dispatch(fetchExpenseClaims())}
          role={team.role}
          selfId={team.selfId}
          allowSelfApproval={settings?.allowSelfApproval ?? false}
          onNewClaim={() => setWizardOpen(true)}
        />
      )}
      {tab === "mileage" && (
        <MileageTab
          journeys={journeys}
          loading={ec.journeysLoading && ec.journeysConnectionId !== activeId}
          error={ec.journeysError}
          onRetry={() => dispatch(fetchJourneys())}
          drivers={team.members}
          driversLoading={team.loading}
          settings={settings}
          role={team.role}
          selfId={team.selfId}
          onOpenSettings={() => setTab("settings")}
        />
      )}
      {tab === "settings" && (
        <ExpenseSettingsTab
          key={activeId}
          members={team.members}
          membersLoading={team.loading}
          membersError={team.error}
          settings={settings}
          settingsLoading={ec.settingsLoading}
          settingsError={ec.settingsError}
          onRetry={() => dispatch(fetchExpenseSettings())}
          role={team.role}
        />
      )}

      <NewClaimWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        receipts={receipts}
        loadingReceipts={invoicesLoading && invoices.length === 0}
        members={team.members}
        contacts={contacts}
        role={team.role}
        selfId={team.selfId}
        onCreated={() => {
          setTab("claims");
          // A claimant typed by name has just become a contact.
          dispatch(fetchClaimContacts());
        }}
      />
    </div>
  );
}
