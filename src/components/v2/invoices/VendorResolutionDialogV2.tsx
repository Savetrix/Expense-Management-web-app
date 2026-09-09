"use client";

import { Building2 } from "lucide-react";

import { taxCodeId, taxCodeName } from "@/lib/quickbooks/taxCode";
import { Badge } from "@/components/ui/Badge";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Modal, SearchInput, SelectDropdown, Tabs } from "@/components/v2/ui";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { VendorRowV2 } from "./VendorRowV2";
import { useVendorResolution } from "./useVendorResolution";

// In-place counterpart of VendorResolutionContentV2 — same
// useVendorResolution hook (same store reads, thunks, and QuickBooks API
// calls), rendered inside the shared Modal shell instead of navigating to
// /v2/invoices/[id]/vendor. Used from InvoiceReviewContentV2 so resolving a
// vendor doesn't lose the reviewer's place on the invoice.
export function VendorResolutionDialogV2({
  invoiceId,
  open,
  onClose,
}: {
  invoiceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const {
    invoiceVendor,
    vendorsLoading,
    glAccounts,
    glAccountsLoading,
    taxCodes,
    taxCodesLoading,
    activeTab,
    setActiveTab,
    searchText,
    setSearchText,
    newVendorName,
    setNewVendorName,
    currency,
    setCurrency,
    creatingVendor,
    selectedVendorId,
    setSelectedVendorId,
    selectedGlAccountId,
    setSelectedGlAccountId,
    selectedTaxCodeIdValue,
    setSelectedTaxCodeIdValue,
    suggestedVendors,
    filteredVendors,
    selectedVendorObj,
    handleConfirm,
    handleCreateVendor,
    tabs,
  } = useVendorResolution(invoiceId, onClose);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resolve Vendor"
      widthClassName="max-w-2xl"
      footer={
        selectedVendorObj && activeTab !== "create" ? (
          <>
            <div className="mr-auto min-w-0 text-left">
              <p className="text-tiny font-bold uppercase tracking-wider text-content-secondary">Selected</p>
              <p className="max-w-[240px] truncate text-body-sm font-bold text-content-primary">{selectedVendorObj.displayName}</p>
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              className="h-9 shrink-0 rounded-md bg-accent px-[var(--space-md)] text-caption font-bold text-accent-ink hover:bg-accent-hover"
            >
              Use this vendor
            </button>
          </>
        ) : activeTab === "create" ? (
          <button
            type="button"
            onClick={() => void handleCreateVendor()}
            disabled={creatingVendor}
            className="h-9 rounded-md bg-accent px-[var(--space-md)] text-caption font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
          >
            {creatingVendor ? "Creating…" : "Create vendor"}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        {/* Vendor on invoice */}
        <div className="flex items-start gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-alt text-content-secondary">
            <Building2 size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-caption text-content-secondary">Vendor on invoice</p>
            <p className="break-words font-bold text-content-primary">{invoiceVendor}</p>
            <Badge variant="warning">Not found in QuickBooks</Badge>
          </div>
        </div>

        <Tabs items={tabs} value={activeTab} onChange={(value) => setActiveTab(value as typeof activeTab)} />

        {activeTab === "suggested" && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            {vendorsLoading ? (
              <SkeletonListRows count={3} />
            ) : suggestedVendors.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface p-[var(--space-lg)] text-center shadow-sm">
                <p className="font-bold text-content-primary">No close matches found</p>
                <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">
                  Switch to &quot;All vendors&quot; to browse, or create a new vendor.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("all")}
                  className="mt-[var(--space-sm)] text-body-sm font-semibold text-accent"
                >
                  Browse all vendors
                </button>
              </div>
            ) : (
              <>
                <p className="text-caption text-content-secondary">
                  These vendors closely match &quot;{invoiceVendor}&quot;. Click to select.
                </p>
                <div className="flex max-h-[360px] flex-col gap-[var(--space-sm)] overflow-y-auto pr-1">
                  {suggestedVendors.map((vendor) => (
                    <VendorRowV2
                      key={vendor._id}
                      vendor={vendor}
                      isSelected={selectedVendorId === vendor._id}
                      onSelect={() => setSelectedVendorId((prev) => (prev === vendor._id ? null : vendor._id))}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "all" && (
          <div className="flex flex-col gap-[var(--space-sm)]">
            <SearchInput
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by name, address or email…"
              widthClassName="w-full"
            />
            {vendorsLoading ? (
              <SkeletonListRows count={3} />
            ) : filteredVendors.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface p-[var(--space-lg)] text-center shadow-sm">
                <p className="font-bold text-content-primary">No results</p>
                <p className="mt-[var(--space-xs)] text-body-sm text-content-secondary">
                  Try a different search term, or create a new vendor.
                </p>
              </div>
            ) : (
              <>
                <p className="text-caption text-content-secondary">
                  {filteredVendors.length} vendor{filteredVendors.length !== 1 ? "s" : ""}
                  {searchText.trim() ? " matched" : " total"}
                </p>
                <div className="flex max-h-[360px] flex-col gap-[var(--space-sm)] overflow-y-auto pr-1">
                  {filteredVendors.map((vendor) => (
                    <VendorRowV2
                      key={vendor._id}
                      vendor={vendor}
                      isSelected={selectedVendorId === vendor._id}
                      onSelect={() => setSelectedVendorId((prev) => (prev === vendor._id ? null : vendor._id))}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "create" && (
          <div className="flex flex-col gap-[var(--space-md)]">
            <div>
              <h2 className="font-bold text-content-primary">Create a new vendor</h2>
              <p className="text-body-sm text-content-secondary">This will add the vendor directly to your QuickBooks account.</p>
            </div>

            <div>
              <label className="text-body-sm font-semibold text-content-primary">Vendor name *</label>
              <input
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="Enter vendor name"
                className="mt-[var(--space-xs)] h-11 w-full rounded-md border border-border bg-surface px-[var(--space-md)] text-body-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div>
              <label className="text-body-sm font-semibold text-content-primary">Currency *</label>
              <SelectDropdown
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-[var(--space-xs)] w-full"
              >
                {CURRENCY_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </SelectDropdown>
            </div>

            <div>
              <label className="text-body-sm font-semibold text-content-primary">GL account *</label>
              <SelectDropdown
                value={selectedGlAccountId}
                onChange={(e) => setSelectedGlAccountId(e.target.value)}
                className="mt-[var(--space-xs)] w-full"
              >
                <option value="">{glAccountsLoading ? "Loading accounts…" : "Select GL account"}</option>
                {glAccounts.map((account) => (
                  <option key={account._id} value={account.qbAccountId}>
                    {account.name}
                  </option>
                ))}
              </SelectDropdown>
            </div>

            <div>
              <label className="text-body-sm font-semibold text-content-primary">Tax code</label>
              <SelectDropdown
                value={selectedTaxCodeIdValue}
                onChange={(e) => setSelectedTaxCodeIdValue(e.target.value)}
                className="mt-[var(--space-xs)] w-full"
              >
                <option value="">{taxCodesLoading ? "Loading tax codes…" : "Select tax code (optional)"}</option>
                {taxCodes.map((code) => (
                  <option key={taxCodeId(code)} value={taxCodeId(code)}>
                    {taxCodeName(code)}
                  </option>
                ))}
              </SelectDropdown>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
