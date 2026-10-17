"use client";

import { useState } from "react";

import { PageHeader, Tabs } from "@/components/v2/ui";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { ApprovalRulesTab } from "./ApprovalRulesTab";
import { AwaitingApprovalTab } from "./AwaitingApprovalTab";
import {
  MOCK_ACCOUNTS,
  MOCK_BILLS,
  MOCK_RULES,
  MOCK_RUNS,
  MOCK_TEAM,
  MOCK_VENDORS,
  type ApprovalRules,
  type Bill,
  type PayVendor,
  type PaymentRun,
  type TeamMember,
} from "./mockData";
import { PaymentRunsTab } from "./PaymentRunsTab";
import { PaymentRunWizard } from "./PaymentRunWizard";
import { mockId, todayIso } from "./shared";
import { ToPayTab } from "./ToPayTab";

type TopTab = "toPay" | "approval" | "runs" | "rules";

// Front-end-only flow: all state lives here, seeded from mockData.ts, so a bill
// sent for approval, approved, then paid moves across the tabs consistently
// while there's no API behind it.
export function PaymentsContentV2() {
  const provider = useActiveProvider();
  const [tab, setTab] = useState<TopTab>("toPay");
  const [bills, setBills] = useState<Bill[]>(MOCK_BILLS);
  const [vendors, setVendors] = useState<PayVendor[]>(MOCK_VENDORS);
  const [runs, setRuns] = useState<PaymentRun[]>(MOCK_RUNS);
  const [rules, setRules] = useState<ApprovalRules>(MOCK_RULES);
  const [team, setTeam] = useState<TeamMember[]>(MOCK_TEAM);
  const accounts = MOCK_ACCOUNTS;
  const [wizardBills, setWizardBills] = useState<Bill[] | null>(null);
  const [wizardKey, setWizardKey] = useState(0);

  const toPay = bills.filter((b) => b.status === "to_pay");
  const awaiting = bills.filter((b) => b.status === "awaiting_approval");

  const patchBills = (ids: string[], patch: Partial<Bill>) =>
    setBills((prev) => prev.map((b) => (ids.includes(b.id) ? { ...b, ...patch } : b)));

  const openWizard = (selected: Bill[]) => {
    if (selected.length === 0) return;
    setWizardKey((k) => k + 1);
    setWizardBills(selected);
  };

  const handleSendForApproval = (ids: string[]) =>
    patchBills(ids, {
      status: "awaiting_approval",
      approverId: rules.approverIds[0],
      requestedAt: todayIso(),
      requestedBy: "You",
      rejection: undefined,
    });

  const handleCreateRun = (run: PaymentRun) => {
    const ids = new Set(run.bills.map((b) => b.billId));
    setBills((prev) => prev.filter((b) => !ids.has(b.id)));
    setRuns((prev) => [run, ...prev]);
  };

  const handleUpdateVendors = (updated: PayVendor[]) =>
    setVendors((prev) => prev.map((v) => updated.find((u) => u.id === v.id) ?? v));

  const handleApproveAndPay = (bill: Bill) => {
    const vendor = vendors.find((v) => v.id === bill.vendorId);
    handleCreateRun({
      id: mockId("run"),
      date: todayIso(),
      bills: [{ billId: bill.id, vendorName: vendor?.name ?? "Vendor", reference: bill.reference, amount: bill.amount }],
      total: bill.amount,
      paidFromId: accounts[0]?.id ?? "",
      status: "processing",
    });
  };

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader title="Payments" subtitle={`Pay your unpaid ${provider.name} bills in batches, with approvals where you need them.`} />

      <div className="mt-[var(--space-lg)] max-w-full overflow-x-auto">
        <Tabs
          items={[
            { value: "toPay", label: "To pay", count: toPay.length },
            { value: "approval", label: "Awaiting approval", count: awaiting.length },
            { value: "runs", label: "Payment runs", count: runs.length },
            { value: "rules", label: "Approval rules" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as TopTab)}
        />
      </div>

      {tab === "toPay" && <ToPayTab bills={toPay} vendors={vendors} onPaySelected={openWizard} />}
      {tab === "approval" && (
        <AwaitingApprovalTab
          bills={awaiting}
          vendors={vendors}
          team={team}
          defaultAccount={accounts[0]}
          onApprove={(bill) => patchBills([bill.id], { status: "to_pay", approved: true, rejection: undefined })}
          onApproveAndPay={handleApproveAndPay}
          onReject={(bill, reason) =>
            patchBills([bill.id], { status: "to_pay", approved: false, rejection: { reason, by: "You", at: todayIso() } })
          }
        />
      )}
      {tab === "runs" && (
        <PaymentRunsTab
          runs={runs}
          accounts={accounts}
          onChangeRun={(id, patch) => setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))}
        />
      )}
      {tab === "rules" && (
        <ApprovalRulesTab
          rules={rules}
          team={team}
          onSave={(nextRules, nextTeam) => {
            setRules(nextRules);
            setTeam(nextTeam);
          }}
        />
      )}

      {wizardBills && (
        <PaymentRunWizard
          key={wizardKey}
          bills={wizardBills}
          vendors={vendors}
          rules={rules}
          team={team}
          accounts={accounts}
          onClose={() => setWizardBills(null)}
          onSendForApproval={handleSendForApproval}
          onCreateRun={handleCreateRun}
          onUpdateVendors={handleUpdateVendors}
        />
      )}
    </div>
  );
}
