"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { notifyBackendPending } from "@/lib/bePlaceholder";
import { showToast } from "@/lib/dialogManager";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";

import { JustificationModal } from "./JustificationModal";
import { TABLE_HEADER_CLASS, fixedAssetsMatched, money, round2, signOffText } from "./closeShared";
import type { CloseSectionProps } from "./sectionTypes";

// Section 4 — the fixed asset register's cost and accumulated depreciation
// totals compared with the matching ledger accounts. Matching balances
// reconcile automatically; a difference is either fixed in the register or
// signed off with a justification.
export function FixedAssetsSection({ paper, onUpdate, actor }: CloseSectionProps) {
  const router = useRouter();
  const provider = useActiveProvider();
  const [justifying, setJustifying] = useState(false);
  const fa = paper.fixedAssets;
  const matched = fixedAssetsMatched(paper);

  const rows = [
    { label: "Cost", account: fa.costAccount, register: fa.registerCost, ledger: fa.ledgerCost },
    { label: "Accumulated depreciation", account: fa.depreciationAccount, register: fa.registerDepreciation, ledger: fa.ledgerDepreciation },
  ];
  const totalDifference = round2(rows.reduce((sum, r) => sum + (r.ledger - r.register), 0));

  const handleReconcile = (justification: string) => {
    notifyBackendPending("Reconcile fixed assets");
    onUpdate((wp) => ({ ...wp, fixedAssets: { ...wp.fixedAssets, reconciled: { by: actor, at: new Date().toISOString(), justification } } }));
    setJustifying(false);
    showToast("Fixed assets reconciled with a justified difference.", "success");
  };

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <p className="text-body-sm text-content-secondary">
        Register totals compared with the cost and accumulated depreciation accounts in {provider.name} at period end.
      </p>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead className="border-b border-border bg-page">
            <tr>
              <th className={TABLE_HEADER_CLASS}>Balance</th>
              <th className={`${TABLE_HEADER_CLASS} text-right`}>Per register</th>
              <th className={`${TABLE_HEADER_CLASS} text-right`}>Per {provider.name}</th>
              <th className={`${TABLE_HEADER_CLASS} text-right`}>Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const diff = round2(r.ledger - r.register);
              return (
                <tr key={r.label}>
                  <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-caption text-content-primary">
                    <span className="block font-semibold">{r.label}</span>
                    <span className="block text-content-secondary">
                      {r.account.code} · {r.account.name}
                    </span>
                  </td>
                  <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption text-content-primary">{money(r.register)}</td>
                  <td className="px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption text-content-primary">{money(r.ledger)}</td>
                  <td
                    className={`px-[var(--space-sm)] py-[var(--space-sm)] text-right text-caption font-semibold ${
                      diff === 0 ? "text-content-primary" : "text-status-danger-text"
                    }`}
                  >
                    {money(diff)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {matched ? (
        <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
          <Badge variant="success">Auto-reconciled</Badge>
          <span className="text-caption text-content-secondary">The register agrees with {provider.name}.</span>
        </div>
      ) : fa.reconciled ? (
        <div className="rounded-md border border-border bg-surface p-[var(--space-md)]">
          <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
            <Badge variant="success">Reconciled</Badge>
            <span className="text-caption text-content-secondary">{signOffText("Reconciled", fa.reconciled)}</span>
          </div>
          {fa.reconciled.justification && (
            <p className="mt-[var(--space-sm)] text-body-sm text-content-primary">
              <span className="font-semibold">Justification: </span>
              {fa.reconciled.justification}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--space-sm)] rounded-md border border-status-warning-border bg-status-warning-bg p-[var(--space-md)] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-status-warning-text">
            The register is {money(Math.abs(totalDifference))} {totalDifference > 0 ? "below" : "above"} {provider.name}. Update the register,
            or reconcile and explain the difference.
          </p>
          <div className="flex shrink-0 flex-wrap gap-[var(--space-sm)]">
            <Button size="sm" variant="outline" onClick={() => router.push("/month-end")}>
              Update register
            </Button>
            <Button size="sm" onClick={() => setJustifying(true)}>
              Reconcile with difference
            </Button>
          </div>
        </div>
      )}

      <JustificationModal
        open={justifying}
        subject="Fixed asset register"
        difference={totalDifference}
        onCancel={() => setJustifying(false)}
        onConfirm={handleReconcile}
      />
    </div>
  );
}
