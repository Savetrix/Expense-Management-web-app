"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Pencil, Plus, RefreshCw, RotateCcw, Store, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { confirmDialog, showToast } from "@/lib/dialogManager";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { taxCodeId as getTaxCodeId, taxCodeName } from "@/lib/quickbooks/taxCode";
import { useRefreshThrottle } from "@/lib/useRefreshThrottle";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";
import {
  createQuickBooksVendor,
  deleteQuickBooksVendor,
  fetchInactiveQuickBooksVendors,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
  getMyQBConnections,
  reactivateQuickBooksVendor,
  syncQuickBooksVendors,
  updateQuickBooksVendor,
} from "@/store/quickBooks/quickBooksApi";
import type { Vendor } from "@/store/quickBooks/quickBooksSlice";
import { VendorCleanupSuggestions } from "./VendorCleanupSuggestions";
import { VendorDetailPanel } from "./VendorDetailPanel";

type VendorTab = "active" | "inactive";

interface QBConnection {
  _id: string;
  name: string;
  realmId: string;
  role: string;
  createdAt: string;
}

interface VendorFormState {
  displayName: string;
  currency: string;
  glAccountId: string;
  taxCodeId: string;
  email: string;
  phone: string;
  address: string;
}

const EMPTY_FORM: VendorFormState = {
  displayName: "",
  currency: CURRENCY_OPTIONS[0],
  glAccountId: "",
  taxCodeId: "",
  email: "",
  phone: "",
  address: "",
};

export function VendorsContent() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const vendorsLoading = useAppSelector((state) => state.quickBooks.vendorsLoading);
  const vendorsError = useAppSelector((state) => state.quickBooks.vendorsError);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const invoices = useAppSelector((state) => state.invoice.invoices);

  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connections, setConnections] = useState<QBConnection[]>([]);
  const [searchText, setSearchText] = useState("");
  const [activeTab, setActiveTab] = useState<VendorTab>("active");

  // Deactivated vendors — kept out of the Redux slice on purpose (see
  // fetchInactiveQuickBooksVendors) so they never leak into the shared
  // active-vendor cache other screens read from.
  const [inactiveVendors, setInactiveVendors] = useState<Vendor[]>([]);
  const [inactiveLoading, setInactiveLoading] = useState(false);
  const [inactiveError, setInactiveError] = useState("");
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  // True only for the specific "GL account is required" failure, so the
  // message can render against the field that caused it.
  const glMissing = formError === "GL account is required to create a vendor";
  const [saving, setSaving] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const attemptRefresh = useRefreshThrottle();

  // With exactly one connected company there's nothing to choose, so use it
  // directly. With 2+, only use a match for an id the user actually
  // selected — the top-bar switcher starts blank when multiple companies are
  // connected, and this page shouldn't silently pick one on its own.
  const activeConnection = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const currentRole = activeConnection?.role || "";
  // Mirrors PERMISSIONS.REVIEW_EDIT_GL on the backend — every role except
  // contributor can manage vendors.
  const canManageVendors = currentRole !== "" && currentRole !== "contributor";

  const fetchConnections = useCallback(async () => {
    if (!accessToken) {
      setLoadingConnections(false);
      return;
    }
    setLoadingConnections(true);
    const result = await dispatch(getMyQBConnections({ accessToken }));
    if (getMyQBConnections.fulfilled.match(result)) {
      setConnections(result.payload?.data?.connections ?? []);
    } else {
      setConnections([]);
    }
    setLoadingConnections(false);
  }, [accessToken, dispatch]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const refetchVendors = useCallback(() => {
    if (!accessToken) return;
    dispatch(fetchQuickBooksVendors({ accessToken }));
  }, [accessToken, dispatch]);

  const refetchInactiveVendors = useCallback(async () => {
    if (!accessToken) return;
    setInactiveLoading(true);
    setInactiveError("");
    const result = await dispatch(fetchInactiveQuickBooksVendors({ accessToken }));
    if (fetchInactiveQuickBooksVendors.fulfilled.match(result)) {
      setInactiveVendors(result.payload || []);
    } else {
      setInactiveVendors([]);
      setInactiveError((result.payload as string) || "Failed to load deactivated vendors");
    }
    setInactiveLoading(false);
  }, [accessToken, dispatch]);

  useEffect(() => {
    if (!accessToken || !activeConnection?._id) return;
    refetchVendors();
    refetchInactiveVendors();
    dispatch(fetchQuickBooksAccounts({ accessToken }));
    dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    // Backs the "Suggested cleanups" box below — it derives its tips from
    // the vendor's own invoice history, not a dedicated stats endpoint.
    dispatch(getInvoices());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activeConnection?._id]);

  const currentList = activeTab === "active" ? vendors : inactiveVendors;
  const currentLoading = activeTab === "active" ? vendorsLoading : inactiveLoading;
  const currentError = activeTab === "active" ? vendorsError : inactiveError;

  const filteredVendors = useMemo(() => {
    if (!searchText.trim()) return currentList;
    const lower = searchText.toLowerCase();
    return currentList.filter(
      (v) =>
        v.displayName?.toLowerCase().includes(lower) ||
        v.email?.toLowerCase().includes(lower) ||
        v.phone?.toLowerCase().includes(lower),
    );
  }, [currentList, searchText]);

  const glAccountName = (id?: string | null) => glAccounts.find((a) => a.qbAccountId === id)?.name;
  const taxCodeLabel = (id?: string | null) => taxCodes.find((t) => getTaxCodeId(t) === id)?.name ?? id ?? undefined;

  // A vendor selected on one tab has no meaning on the other (active vs
  // inactive are disjoint lists), so switching tabs clears the selection
  // rather than leaving a stale detail panel or silently pointing at nothing.
  useEffect(() => {
    setSelectedVendorId(null);
  }, [activeTab]);

  const selectedVendor = useMemo(
    () => currentList.find((v) => v._id === selectedVendorId) || null,
    [currentList, selectedVendorId],
  );

  const openCreateSheet = () => {
    setEditingVendor(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setSheetVisible(true);
  };

  // Lets the sidebar's "Create → Vendor" shortcut land straight in create
  // mode via /vendors?create=true, instead of just the plain list. Waits for
  // loadingConnections to resolve so canManageVendors reflects the real role
  // before deciding whether to open it; runs at most once per page load.
  const autoOpenedCreateRef = useRef(false);
  useEffect(() => {
    if (autoOpenedCreateRef.current) return;
    if (searchParams.get("create") !== "true") return;
    if (loadingConnections) return;
    if (!canManageVendors) return;
    autoOpenedCreateRef.current = true;
    openCreateSheet();
    router.replace("/vendors");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadingConnections, canManageVendors]);

  const openEditSheet = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setForm({
      displayName: vendor.displayName,
      currency: vendor.currency || CURRENCY_OPTIONS[0],
      glAccountId: vendor.glAccountId || "",
      taxCodeId: vendor.taxCodeId || "",
      email: vendor.email || "",
      phone: vendor.phone || "",
      address: vendor.address || "",
    });
    setFormError("");
    setSheetVisible(true);
  };

  const closeSheet = () => {
    if (saving) return;
    setSheetVisible(false);
  };

  const handleSave = async () => {
    if (!accessToken) return;

    const trimmedName = form.displayName.trim();
    if (!trimmedName) {
      setFormError("Vendor name is required");
      return;
    }
    // Tax code is intentionally optional — it only applies to QB companies
    // that use tax codes (e.g. Canada).
    if (!editingVendor && !form.glAccountId) {
      setFormError("GL account is required to create a vendor");
      return;
    }

    setFormError("");
    setSaving(true);
    try {
      if (editingVendor) {
        const result = await dispatch(
          updateQuickBooksVendor({
            accessToken,
            vendorId: editingVendor._id,
            displayName: trimmedName,
            glAccountId: form.glAccountId,
            taxCodeId: form.taxCodeId,
            email: form.email.trim(),
            phone: form.phone.trim(),
            address: form.address.trim(),
          }),
        );
        if (updateQuickBooksVendor.fulfilled.match(result)) {
          setSheetVisible(false);
          showToast(`${trimmedName} updated.`, "success");
        } else {
          const payload = result.payload as { message?: string } | undefined;
          showToast(payload?.message || "Could not update vendor. Please try again.", "error");
        }
      } else {
        const result = await dispatch(
          createQuickBooksVendor({
            accessToken,
            displayName: trimmedName,
            currency: form.currency,
            glAccountId: form.glAccountId,
            taxCodeId: form.taxCodeId,
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            address: form.address.trim() || undefined,
          }),
        );
        if (createQuickBooksVendor.fulfilled.match(result)) {
          setSheetVisible(false);
          showToast(`${trimmedName} added.`, "success");
          refetchVendors();
        } else {
          const payload = result.payload as { message?: string } | undefined;
          showToast(payload?.message || "Could not create vendor. Please try again.", "error");
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (vendor: Vendor) => {
    if (!accessToken) return;
    const confirmed = await confirmDialog({
      title: "Deactivate vendor?",
      message: `"${vendor.displayName}" will be marked inactive in Scantrix and won't be matched against new invoices. It stays active in QuickBooks — this only affects Scantrix. Existing bills already posted for this vendor are not affected.`,
      confirmLabel: "Deactivate",
      tone: "destructive",
    });
    if (!confirmed) return;

    setDeactivatingId(vendor._id);
    try {
      const result = await dispatch(deleteQuickBooksVendor({ accessToken, vendorId: vendor._id }));
      if (deleteQuickBooksVendor.fulfilled.match(result)) {
        showToast(`${vendor.displayName} deactivated.`, "success");
        // Refresh the inactive list so it includes this vendor right away.
        refetchInactiveVendors();
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not deactivate vendor. Please try again.", "error");
      }
    } finally {
      setDeactivatingId(null);
    }
  };

  const handleReactivate = async (vendor: Vendor) => {
    if (!accessToken) return;
    const confirmed = await confirmDialog({
      title: "Reactivate vendor?",
      message: `"${vendor.displayName}" will become active again in Scantrix and can be matched against new invoices.`,
      confirmLabel: "Reactivate",
    });
    if (!confirmed) return;

    setReactivatingId(vendor._id);
    try {
      const result = await dispatch(reactivateQuickBooksVendor({ accessToken, vendorId: vendor._id }));
      if (reactivateQuickBooksVendor.fulfilled.match(result)) {
        setInactiveVendors((prev) => prev.filter((v) => v._id !== vendor._id));
        refetchVendors();
        showToast(`${vendor.displayName} reactivated.`, "success");
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not reactivate vendor. Please try again.", "error");
      }
    } finally {
      setReactivatingId(null);
    }
  };

  const handleApplyGlAccount = async (vendor: Vendor, glAccountId: string) => {
    if (!accessToken) return false;
    const result = await dispatch(updateQuickBooksVendor({ accessToken, vendorId: vendor._id, glAccountId }));
    if (updateQuickBooksVendor.fulfilled.match(result)) {
      showToast(`Default GL account updated for ${vendor.displayName}.`, "success");
      return true;
    }
    const payload = result.payload as { message?: string } | undefined;
    showToast(payload?.message || "Could not update GL account.", "error");
    return false;
  };

  const handleApplyTaxCode = async (vendor: Vendor, taxCodeId: string) => {
    if (!accessToken) return false;
    const result = await dispatch(updateQuickBooksVendor({ accessToken, vendorId: vendor._id, taxCodeId }));
    if (updateQuickBooksVendor.fulfilled.match(result)) {
      showToast(`Default tax code updated for ${vendor.displayName}.`, "success");
      return true;
    }
    const payload = result.payload as { message?: string } | undefined;
    showToast(payload?.message || "Could not update tax code.", "error");
    return false;
  };

  const handleRefresh = async () => {
    if (!accessToken || refreshing) return;
    const waitSeconds = attemptRefresh();
    if (waitSeconds !== null) {
      showToast(`You're refreshing too often. Try again in ${waitSeconds}s.`, "error");
      return;
    }
    setRefreshing(true);
    try {
      const result = await dispatch(syncQuickBooksVendors({ accessToken }));
      if (syncQuickBooksVendors.fulfilled.match(result)) {
        refetchVendors();
        refetchInactiveVendors();
        showToast("Vendors refreshed from QuickBooks.", "success");
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not refresh from QuickBooks. Please try again.", "error");
      }
    } finally {
      setRefreshing(false);
    }
  };

  if (loadingConnections) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
        <EmptyState
          icon={<Store size={28} strokeWidth={1.75} />}
          title={connections.length > 0 ? "Select a company" : "No company connected"}
          description={
            connections.length > 0
              ? "Choose a company from the switcher up top to manage its vendors."
              : "Connect a QuickBooks company before managing vendors."
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-[var(--space-lg)]">
      <div className="flex items-center justify-between gap-[var(--space-md)]">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-trust-navy">Vendors</h1>
          <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
            Manage vendors for {activeConnection.name}.
          </p>
        </div>
        {canManageVendors && (
          <div className="flex shrink-0 items-center gap-[var(--space-sm)]">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh from QuickBooks"
              title="Refresh from QuickBooks"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-white text-trust-navy transition-opacity hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={18} strokeWidth={2.25} className={refreshing ? "animate-spin" : ""} />
            </button>
            <Button onClick={openCreateSheet} size="sm" className="shrink-0">
              <Plus size={16} strokeWidth={2.5} />
              Add Vendor
            </Button>
          </div>
        )}
      </div>

      {!canManageVendors && (
        <Card className="mt-[var(--space-md)] text-body-sm text-text-secondary">
          You have contributor access on {activeConnection.name} and can view vendors but not manage them.
        </Card>
      )}

      <div className="mt-[var(--space-lg)] grid grid-cols-1 gap-[var(--space-lg)] lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div>
          <div className="flex gap-[var(--space-xs)] rounded-md bg-background-alt p-[var(--space-xs)]">
            {(["active", "inactive"] as VendorTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                aria-current={activeTab === tab ? "page" : undefined}
                className={`flex-1 rounded-md px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-semibold ${
                  activeTab === tab ? "bg-white text-primary shadow-sm" : "text-text-secondary"
                }`}
              >
                {tab === "active" ? `Active (${vendors.length})` : `Inactive (${inactiveVendors.length})`}
              </button>
            ))}
          </div>

          {currentList.length > 0 && (
            <Input
              placeholder="Search by name, email or phone…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="mt-[var(--space-md)] w-full"
            />
          )}

          <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)]">
            {currentLoading ? (
              <SkeletonListRows count={4} />
            ) : currentError ? (
              <ErrorState message={currentError} onRetry={activeTab === "active" ? refetchVendors : refetchInactiveVendors} />
            ) : currentList.length === 0 ? (
              activeTab === "active" ? (
                <EmptyState
                  icon={<Store size={28} strokeWidth={1.75} />}
                  title="No vendors yet"
                  description="Vendors sync automatically from QuickBooks, or add one manually."
                  actionLabel={canManageVendors ? "Add Vendor" : undefined}
                  onAction={canManageVendors ? openCreateSheet : undefined}
                />
              ) : (
                <EmptyState
                  icon={<Ban size={28} strokeWidth={1.75} />}
                  title="No deactivated vendors"
                  description="Vendors you deactivate will show up here so you can reactivate them later."
                />
              )
            ) : filteredVendors.length === 0 ? (
              <Card className="text-center text-body-sm text-text-secondary">No vendors match &quot;{searchText}&quot;.</Card>
            ) : (
              filteredVendors.map((vendor) => {
                const glName = glAccountName(vendor.glAccountId);
                const taxName = taxCodeLabel(vendor.taxCodeId);
                const isDeactivating = deactivatingId === vendor._id;
                const isReactivating = reactivatingId === vendor._id;
                const isSelected = selectedVendorId === vendor._id;
                return (
                  <Card
                    key={vendor._id}
                    onClick={() => setSelectedVendorId(vendor._id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedVendorId(vendor._id);
                      }
                    }}
                    className={`flex cursor-pointer items-start justify-between gap-[var(--space-md)] transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "hover:bg-background-alt"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-[var(--space-sm)]">
                        <p className="truncate font-bold text-text-primary">{vendor.displayName}</p>
                        {vendor.currency && <Badge variant="neutral">{vendor.currency}</Badge>}
                      </div>
                      {(vendor.email || vendor.phone) && (
                        <p className="mt-[var(--space-xs)] truncate text-body-sm text-text-secondary">
                          {[vendor.email, vendor.phone].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {(glName || taxName) && (
                        <p className="mt-[var(--space-xs)] truncate text-caption text-text-secondary">
                          {[glName && `GL: ${glName}`, taxName && `Tax: ${taxName}`].filter(Boolean).join("  ·  ")}
                        </p>
                      )}
                    </div>
                    {canManageVendors && (
                      <div className="flex shrink-0 items-center gap-[var(--space-xs)]" onClick={(e) => e.stopPropagation()}>
                        {activeTab === "active" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditSheet(vendor)}
                              aria-label={`Edit ${vendor.displayName}`}
                              className="flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-background-alt lg:h-8 lg:w-8"
                            >
                              <Pencil size={16} strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeactivate(vendor)}
                              disabled={isDeactivating}
                              aria-label={`Deactivate ${vendor.displayName}`}
                              className="flex h-10 w-10 items-center justify-center rounded-md bg-error/10 text-error disabled:cursor-not-allowed disabled:opacity-60 lg:h-8 lg:w-8"
                            >
                              {isDeactivating ? "…" : <Ban size={16} strokeWidth={2} />}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleReactivate(vendor)}
                            disabled={isReactivating}
                            aria-label={`Reactivate ${vendor.displayName}`}
                            className="flex h-10 items-center gap-[var(--space-xs)] rounded-md bg-primary/10 px-[var(--space-sm)] text-caption font-bold text-primary disabled:cursor-not-allowed disabled:opacity-60 lg:h-8"
                          >
                            {isReactivating ? "…" : <RotateCcw size={14} strokeWidth={2.25} />}
                            Reactivate
                          </button>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>

        <div className="flex flex-col gap-[var(--space-md)] lg:sticky lg:top-[var(--space-lg)]">
          {selectedVendor ? (
            <VendorDetailPanel
              vendor={selectedVendor}
              glAccounts={glAccounts}
              taxCodes={taxCodes}
              invoices={invoices}
              canManage={canManageVendors}
              isInactive={activeTab === "inactive"}
              onEdit={() => openEditSheet(selectedVendor)}
              onDeactivate={() => handleDeactivate(selectedVendor)}
              onReactivate={() => handleReactivate(selectedVendor)}
              deactivating={deactivatingId === selectedVendor._id}
              reactivating={reactivatingId === selectedVendor._id}
            />
          ) : (
            <Card className="text-center text-body-sm text-text-secondary">
              Select a vendor to see their details and recent invoices.
            </Card>
          )}

          {canManageVendors && activeTab === "active" && (
            <VendorCleanupSuggestions
              vendors={vendors}
              glAccounts={glAccounts}
              taxCodes={taxCodes}
              invoices={invoices}
              onApplyGlAccount={handleApplyGlAccount}
              onApplyTaxCode={handleApplyTaxCode}
              onOpenEdit={openEditSheet}
              onDeactivate={handleDeactivate}
            />
          )}
        </div>
      </div>

      {sheetVisible && (
        <div className="fixed inset-0 z-50 flex cursor-pointer items-end justify-center bg-black/40 sm:items-center" onClick={closeSheet}>
          <div
            className="max-h-[90vh] w-full max-w-md cursor-auto overflow-y-auto rounded-t-2xl bg-white p-[var(--space-lg)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--space-md)] flex items-center justify-between">
              <h2 className="text-h3 font-bold text-text-primary">{editingVendor ? "Edit Vendor" : "Add Vendor"}</h2>
              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close"
                className="-m-[var(--space-sm)] p-[var(--space-sm)] text-text-secondary"
              >
                <X size={20} strokeWidth={2.25} />
              </button>
            </div>

            <div className="flex flex-col gap-[var(--space-md)]">
              <Input
                label="Vendor name *"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Enter vendor name"
                disabled={saving}
              />

              <div>
                <label className="text-body-sm font-semibold text-trust-navy">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  disabled={saving || !!editingVendor}
                  className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-white px-[var(--space-md)] text-body focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-background-alt disabled:text-text-secondary"
                >
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                {editingVendor && (
                  <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
                    Currency can&apos;t be changed after a vendor is created.
                  </p>
                )}
              </div>

              <div>
                <label className="text-body-sm font-semibold text-trust-navy">
                  GL account{!editingVendor && " *"}
                </label>
                <select
                  value={form.glAccountId}
                  onChange={(e) => {
                    const glAccountId = e.target.value;
                    setForm((f) => ({ ...f, glAccountId }));
                    // Clear the requirement message as soon as it is satisfied,
                    // rather than leaving stale red text under the field.
                    if (glAccountId && glMissing) setFormError("");
                  }}
                  disabled={saving}
                  aria-invalid={glMissing || undefined}
                  aria-describedby={glMissing ? "vendor-gl-error" : undefined}
                  className={`mt-[var(--space-xs)] h-[50px] w-full rounded-md border bg-white px-[var(--space-md)] text-body focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                    glMissing ? "border-error" : "border-border"
                  }`}
                >
                  <option value="">Select GL account</option>
                  {glAccounts.map((account) => (
                    <option key={account._id} value={account.qbAccountId}>
                      {account.name}
                    </option>
                  ))}
                </select>
                {glMissing && (
                  <p id="vendor-gl-error" className="mt-[var(--space-xs)] text-caption font-semibold text-error">
                    {formError}
                  </p>
                )}
                {!editingVendor && glAccounts.length === 0 && (
                  // Otherwise the form is unsatisfiable with no explanation:
                  // creation is blocked on a field that has nothing to pick.
                  <p className="mt-[var(--space-xs)] text-caption text-text-secondary">
                    No GL accounts found. Sync them from QuickBooks first.
                  </p>
                )}
              </div>

              <div>
                <label className="text-body-sm font-semibold text-trust-navy">Tax code</label>
                <select
                  value={form.taxCodeId}
                  onChange={(e) => setForm((f) => ({ ...f, taxCodeId: e.target.value }))}
                  disabled={saving}
                  className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-white px-[var(--space-md)] text-body focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Select tax code (not applicable if your QB company doesn&apos;t use tax codes)</option>
                  {taxCodes.map((code) => (
                    <option key={getTaxCodeId(code)} value={getTaxCodeId(code)}>
                      {taxCodeName(code)}
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="vendor@company.com"
                disabled={saving}
              />

              <Input
                label="Phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+1 555 000 0000"
                disabled={saving}
              />

              <Input
                label="Address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Street, city, country"
                disabled={saving}
              />

              {formError && <p className="text-caption font-semibold text-error">{formError}</p>}

              <Button onClick={handleSave} loading={saving} disabled={saving} className="mt-[var(--space-xs)] w-full">
                {editingVendor ? "Save changes" : "Create vendor"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
