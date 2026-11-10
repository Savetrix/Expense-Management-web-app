"use client";

import { Plus, Receipt } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, Tabs } from "@/components/v2/ui";
import {
  fetchClaimContacts,
  fetchClaimSummary,
  fetchExpenseClaims,
  fetchExpenseSettings,
  fetchJourneys,
} from "@/store/expenseClaims/expenseClaimsApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

import { ClaimsTab } from "./ClaimsTab";
import { ExpenseSettingsTab } from "./ExpenseSettingsTab";
import { MileageTab } from "./MileageTab";
import { NewClaimWizard } from "./NewClaimWizard";
import { useTeamMembers } from "./useTeamMembers";

type TopTab = "claims" | "mileage" | "settings";

// The tab counts show what still needs something done — paid and rejected
// ones are finished.
const isOpen = ({ status }: { status: string }) => status === "awaiting_review" || status === "awaiting_reimbursement";

export function ExpenseClaimsContentV2() {
  const dispatch = useAppDispatch();
  const team = useTeamMembers();
  const { activeId } = team;
  const ec = useAppSelector((state) => state.expenseClaims);

  const [tab, setTab] = useState<TopTab>("claims");
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!activeId) return;
    dispatch(fetchExpenseClaims());
    dispatch(fetchJourneys());
    dispatch(fetchExpenseSettings());
    dispatch(fetchClaimContacts());
  }, [activeId, dispatch]);

  // Keep the sidebar's "assigned to me" count (claims + trips) in step with
  // approvals, rejections and new claims or trips made here.
  useEffect(() => {
    if (activeId && ec.claimsConnectionId === activeId) dispatch(fetchClaimSummary());
  }, [activeId, ec.claimsConnectionId, ec.claims, ec.journeys, dispatch]);

  // A list loaded for another company is treated as not loaded.
  const claims = ec.claimsConnectionId === activeId ? ec.claims : [];
  const journeys = ec.journeysConnectionId === activeId ? ec.journeys : [];
  const settings = ec.settingsConnectionId === activeId ? ec.settings : null;
  const contacts = ec.contactsConnectionId === activeId ? ec.contacts : [];

  if (!team.hasCompany) {
    return (
      <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
        <PageHeader title="Expense Claims" subtitle="Reimburse employees for out-of-pocket receipts and business trips." />
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
        subtitle="Reimburse employees for out-of-pocket receipts and business trips."
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
            { value: "claims", label: "Claims", count: claims.filter(isOpen).length },
            { value: "mileage", label: "Mileage", count: journeys.filter(isOpen).length },
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
          canOpenInvoices={team.canOpenInvoices}
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
