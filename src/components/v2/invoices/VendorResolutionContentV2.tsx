"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronLeft } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoiceDetails } from "@/store/invoice/invoiceApi";
import {
  createQuickBooksVendor,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
} from "@/store/quickBooks/quickBooksApi";
import type { Vendor } from "@/store/quickBooks/quickBooksSlice";
import { setSelectedVendor } from "@/store/vendor/vendorSlice";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { showToast } from "@/lib/dialogManager";
import { taxCodeId, taxCodeName } from "@/lib/quickbooks/taxCode";
import { Badge } from "@/components/ui/Badge";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { SearchInput, SelectDropdown, Tabs } from "@/components/v2/ui";

type ActiveTab = "suggested" | "all" | "create";

// v2 counterpart of VendorResolutionContent (v1) — same store/thunks/handlers
// verbatim, restyled onto this app's dense v2 tokens (bg-surface/border-border,
// Tabs/SelectDropdown/SearchInput/Badge primitives) instead of the mobile-style
// full-bleed colored header the v1 screen ports from Scantrix_v2. No Stitch
// mockup exists for this screen, so it follows InvoiceReviewContentV2's own
// established v2 conventions (sticky neutral header with actions, bg-surface
// cards) rather than inventing new patterns.
export function VendorResolutionContentV2({ invoiceId }: { invoiceId: string }) {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const selectedInvoice = useAppSelector((state) => state.invoice.selectedInvoice);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const vendorsLoading = useAppSelector((state) => state.quickBooks.vendorsLoading);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const glAccountsLoading = useAppSelector((state) => state.quickBooks.accountsLoading);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const taxCodesLoading = useAppSelector((state) => state.quickBooks.taxCodesLoading);
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);

  useEffect(() => {
    dispatch(getInvoiceDetails(invoiceId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  useEffect(() => {
    if (!accessToken) return;
    dispatch(fetchQuickBooksVendors({ accessToken }));
    dispatch(fetchQuickBooksAccounts({ accessToken }));
    dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const invoiceVendor =
    selectedInvoice?.extractedData?.vendorName ||
    selectedInvoice?.file?.originalName?.replace(/\.pdf$/i, "")?.replace(/%20/g, " ") ||
    "Unknown Vendor";

  const [activeTab, setActiveTab] = useState<ActiveTab>("suggested");
  const [searchText, setSearchText] = useState("");
  const [newVendorName, setNewVendorName] = useState(invoiceVendor);
  const [currency, setCurrency] = useState(CURRENCY_OPTIONS[0]);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedGlAccountId, setSelectedGlAccountId] = useState("");
  const [selectedTaxCodeIdValue, setSelectedTaxCodeIdValue] = useState("");

  useEffect(() => {
    setNewVendorName(invoiceVendor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceVendor]);

  const suggestedVendors = useMemo(() => {
    const lower = invoiceVendor.toLowerCase();
    return vendors.filter((v) => v.displayName?.toLowerCase().includes(lower)).slice(0, 5);
  }, [vendors, invoiceVendor]);

  const filteredVendors = useMemo(() => {
    if (!searchText.trim()) return vendors;
    return vendors.filter((v) => v.displayName?.toLowerCase().includes(searchText.toLowerCase()));
  }, [searchText, vendors]);

  const selectedVendorObj = useMemo(
    () => vendors.find((v) => v._id === selectedVendorId) || null,
    [vendors, selectedVendorId],
  );

  const handleConfirm = () => {
    if (!selectedVendorObj) return;
    dispatch(
      setSelectedVendor({
        forInvoiceId: invoiceId,
        _id: selectedVendorObj._id,
        displayName: selectedVendorObj.displayName,
        qbVendorId: selectedVendorObj.qbVendorId,
        email: null,
        phone: null,
        address: null,
        glAccountId: selectedVendorObj.glAccountId ?? null,
        taxCodeId: selectedVendorObj.taxCodeId ?? null,
      }),
    );
    router.back();
  };

  const handleCreateVendor = async () => {
    if (!newVendorName.trim()) {
      showToast("Please enter a vendor name.", "error");
      return;
    }
    // The backend rejects a vendor created without a default GL account
    // ("QuickBooks requires a default GL account for new vendors" — observed
    // from a real create). This screen used to label the field optional and
    // send an empty value, so the create failed at the backend after the user
    // had filled everything in. The Vendors page has always required it; these
    // two paths now agree.
    if (!selectedGlAccountId) {
      showToast("Choose a GL account — QuickBooks requires one for a new vendor.", "error");
      return;
    }
    if (creatingVendor || !accessToken) return;
    setCreatingVendor(true);
    try {
      const result = await dispatch(
        createQuickBooksVendor({
          accessToken,
          displayName: newVendorName.trim(),
          currency,
          glAccountId: selectedGlAccountId,
          taxCodeId: selectedTaxCodeIdValue,
        }),
      );

      if (createQuickBooksVendor.fulfilled.match(result)) {
        const createdPayload = result.payload as Record<string, unknown>;
        const createdVendorData =
          (createdPayload?.data as Record<string, unknown> | undefined)?.vendor ||
          (createdPayload?.data as Record<string, unknown> | undefined)?.Vendor ||
          createdPayload?.vendor ||
          createdPayload?.Vendor ||
          createdPayload?.data ||
          createdPayload ||
          {};
        const created = createdVendorData as Record<string, unknown>;

        dispatch(
          setSelectedVendor({
            forInvoiceId: invoiceId,
            _id: (created?._id as string) || "",
            displayName: (created?.displayName as string) || (created?.DisplayName as string) || newVendorName.trim(),
            qbVendorId: (created?.qbVendorId as string) || (created?.Id as string) || "",
            email:
              (created?.email as string) ||
              ((created?.PrimaryEmailAddr as { Address?: string } | undefined)?.Address ?? null),
            phone:
              (created?.phone as string) ||
              ((created?.PrimaryPhone as { FreeFormNumber?: string } | undefined)?.FreeFormNumber ?? null),
            address: (created?.address as string) || null,
            glAccountId: (created?.glAccountId as string) || selectedGlAccountId || null,
            taxCodeId: (created?.taxCodeId as string) || selectedTaxCodeIdValue || null,
          }),
        );

        // The backend already saved this vendor to the local DB as part of
        // creating it — refetch (cheap local read) so it shows up in the
        // Redux vendor list for every other screen, not just this invoice's
        // resolution, without another soft-navigation round trip.
        await dispatch(fetchQuickBooksVendors({ accessToken }));

        router.back();
      } else {
        const payload = result.payload as { message?: string } | undefined;

        // The backend now checks its own DB and QuickBooks itself before
        // attempting a create, so a genuine duplicate-name throw here should
        // be rare — but as a safety net, refetch the vendor list and see
        // whether our vendor exists under a stable id anyway before giving up.
        const refetch = await dispatch(fetchQuickBooksVendors({ accessToken }));
        const refetchedPayload = refetch.payload;
        const freshVendors: Vendor[] = Array.isArray(refetchedPayload) ? refetchedPayload : [];
        const target = newVendorName.trim();
        const fresh =
          freshVendors.find((v) => v.displayName?.trim().toLowerCase() === target.toLowerCase()) ??
          freshVendors.find((v) => v.normalizedName?.trim().toLowerCase() === target.toLowerCase());

        if (fresh) {
          dispatch(
            setSelectedVendor({
              forInvoiceId: invoiceId,
              _id: fresh._id,
              displayName: fresh.displayName,
              qbVendorId: fresh.qbVendorId,
              email: fresh.email ?? null,
              phone: fresh.phone ?? null,
              address: fresh.address ?? null,
              glAccountId: fresh.glAccountId ?? null,
              taxCodeId: fresh.taxCodeId ?? null,
            }),
          );
          showToast(`"${fresh.displayName}" was created in QuickBooks.`, "success");
          router.back();
          return;
        }

        showToast(payload?.message || "Failed to create vendor", "error");
      }
    } finally {
      setCreatingVendor(false);
    }
  };

  const tabs = [
    { value: "suggested", label: "Suggested", count: suggestedVendors.length },
    { value: "all", label: "All vendors" },
    { value: "create", label: "Create new" },
  ];

  // NOTE: the ported Vendor type (quickBooksSlice.ts) only carries
  // _id/qbVendorId/displayName/normalizedName — mobile's screen-local Vendor
  // type additionally assumed address/email/phone fields that don't exist on
  // the real ported contract, so this row only ever shows the display name.
  const VendorRow = ({ vendor }: { vendor: { _id: string; displayName: string } }) => {
    const isSelected = selectedVendorId === vendor._id;
    return (
      <button
        type="button"
        onClick={() => setSelectedVendorId((prev) => (prev === vendor._id ? null : vendor._id))}
        className={`flex w-full items-center justify-between gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] text-left transition-colors ${
          isSelected ? "border-accent bg-accent-bg/40" : "border-border bg-surface hover:bg-surface-alt"
        }`}
      >
        <p className={`min-w-0 flex-1 truncate text-body-sm font-semibold ${isSelected ? "text-accent" : "text-content-primary"}`}>
          {vendor.displayName}
        </p>
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
            isSelected ? "border-accent bg-accent" : "border-border-strong"
          }`}
        >
          {isSelected && <span className="h-2 w-2 rounded-full bg-surface" />}
        </span>
      </button>
    );
  };

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

        <Tabs items={tabs} value={activeTab} onChange={(value) => setActiveTab(value as ActiveTab)} />

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
                  <VendorRow key={vendor._id} vendor={vendor} />
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
                  <VendorRow key={vendor._id} vendor={vendor} />
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
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setCurrency(e.target.value)}
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
