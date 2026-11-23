"use client";

import { Plus, Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, Tabs } from "@/components/v2/ui";
import {
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

/**
 * Back from editing a receipt on the review screen: `reopenWizardWith` reopens
 * the new-claim wizard with those receipts ticked, `reopenClaimId` that claim.
 */
export function ExpenseClaimsContentV2({ reopenWizardWith = null, reopenClaimId = null }: { reopenWizardWith?: string[] | null; reopenClaimId?: string | null }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const team = useTeamMembers();
  const { activeId } = team;
  const ec = useAppSelector((state) => state.expenseClaims);

  const [tab, setTab] = useState<TopTab>("claims");
  const [wizardOpen, setWizardOpen] = useState(!!reopenWizardWith);
  // Taken once from the URL, which is then cleaned so a refresh doesn't reopen it.
  const [wizardSeed] = useState(reopenWizardWith);
  // Opened once — leaving the Claims tab forgets it, so coming back doesn't reopen it.
  const [claimToOpen, setClaimToOpen] = useState(reopenClaimId);
  useEffect(() => {
    if (reopenWizardWith || reopenClaimId) router.replace("/reimbursements");
    // Only the URL this page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) return;
    dispatch(fetchExpenseClaims());
    dispatch(fetchJourneys());
    dispatch(fetchExpenseSettings());
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

  if (!team.hasCompany) {
    return (
      <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
        <PageHeader title="Reimbursements" subtitle="Reimburse employees for out-of-pocket receipts and business trips." />
        <EmptyState
          icon={<Receipt size={28} strokeWidth={1.75} />}
          title="Pick a company"
          description="Choose a company in the header to see its reimbursements."
        />
      </div>
    );
  }

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Reimbursements"
        subtitle="Reimburse employees for out-of-pocket receipts and business trips."
        action={
          tab === "claims" ? (
            <Button size="sm" onClick={() => setWizardOpen(true)} className="shrink-0">
              <Plus size={16} strokeWidth={2.5} />
              New reimbursement
            </Button>
          ) : undefined
        }
      />

      <div className="mt-[var(--space-lg)]">
        <Tabs
          items={[
            // Only what's still in progress — paid and rejected ones aren't counted.
            { value: "claims", label: "Claims", count: claims.filter(isOpen).length, countSuffix: "open" },
            { value: "mileage", label: "Mileage", count: journeys.filter(isOpen).length, countSuffix: "open" },
            { value: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={(v) => {
            setClaimToOpen(null);
            setTab(v as TopTab);
          }}
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
          initialOpenClaimId={claimToOpen}
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
        role={team.role}
        selfId={team.selfId}
        canOpenInvoices={team.canOpenInvoices}
        initialSelected={wizardSeed}
        onCreated={() => setTab("claims")}
      />
    </div>
  );
}
