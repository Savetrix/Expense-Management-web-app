"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronLeft } from "lucide-react";

import { taxCodeId, taxCodeName } from "@/lib/quickbooks/taxCode";
import { Badge } from "@/components/ui/Badge";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { SearchInput, SelectDropdown, Tabs } from "@/components/v2/ui";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { VendorRowV2 } from "./VendorRowV2";
import { useVendorResolution } from "./useVendorResolution";

// v2 counterpart of VendorResolutionContent (v1) — same store/thunks/handlers
// (now shared with VendorResolutionDialogV2 via useVendorResolution)
// verbatim, restyled onto this app's dense v2 tokens (bg-surface/border-border,
// Tabs/SelectDropdown/SearchInput/Badge primitives) instead of the mobile-style
// full-bleed colored header the v1 screen ports from Scantrix_v2. No Stitch
// mockup exists for this screen, so it follows InvoiceReviewContentV2's own
// established v2 conventions (sticky neutral header with actions, bg-surface
// cards) rather than inventing new patterns.
export function VendorResolutionContentV2({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();

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
  } = useVendorResolution(invoiceId, () => router.back());

  return (
    <div className="w-full">
      {/* Header — matches InvoiceReviewContentV2's slim sticky neutral action
          bar rather than v1's full-bleed colored mobile-style header. */}
      <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-[var(--space-sm)] border-b border-border bg-page px-[var(--space-md)] py-[var(--space-xs)] sm:px-[var(--space-lg)] sm:py-[var(--space-sm)]">
        <div className="flex items-center gap-[var(--space-sm)]">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-[var(--space-xs)] rounded-md px-[var(--space-xs)] py-[var(--space-xs)] text-body-sm font-bold text-content-secondary hover:bg-surface-alt hover:text-content-primary"
          >
            <ChevronLeft size={18} strokeWidth={2.25} />
            Back
          </button>
          <span className="hidden text-border-strong sm:inline">|</span>
          <h1 className="hidden text-caption font-bold uppercase tracking-wide text-content-secondary sm:inline">
            Resolve Vendor
          </h1>
        </div>

        {selectedVendorObj && activeTab !== "create" && (
          <div className="flex items-center gap-[var(--space-sm)]">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="text-tiny font-bold uppercase tracking-wider text-content-secondary">Selected</p>
              <p className="max-w-[200px] truncate text-body-sm font-bold text-content-primary">{selectedVendorObj.displayName}</p>
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              className="h-9 shrink-0 rounded-md bg-accent px-[var(--space-md)] text-caption font-bold text-accent-ink hover:bg-accent-hover"
            >
              Use this vendor
            </button>
          </div>
        )}
      </div>

      <div className="mx-auto flex max-w-2xl flex-col gap-[var(--space-md)] p-[var(--space-md)] sm:p-[var(--space-lg)]">
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
                {suggestedVendors.map((vendor) => (
                  <VendorRowV2
                    key={vendor._id}
                    vendor={vendor}
                    isSelected={selectedVendorId === vendor._id}
                    onSelect={() => setSelectedVendorId((prev) => (prev === vendor._id ? null : vendor._id))}
                  />
                ))}
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
                {filteredVendors.map((vendor) => (
                  <VendorRowV2
                    key={vendor._id}
                    vendor={vendor}
                    isSelected={selectedVendorId === vendor._id}
                    onSelect={() => setSelectedVendorId((prev) => (prev === vendor._id ? null : vendor._id))}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === "create" && (
          <div className="flex flex-col gap-[var(--space-md)] rounded-lg border border-border bg-surface p-[var(--space-md)] shadow-sm">
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

            <button
              type="button"
              onClick={() => void handleCreateVendor()}
              disabled={creatingVendor}
              className="h-11 rounded-md bg-accent font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
            >
              {creatingVendor ? "Creating…" : "Create vendor"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
