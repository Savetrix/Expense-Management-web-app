"use client";

import { Ban, Pencil, Plus, RotateCcw, Store, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createQuickBooksVendor,
  deleteQuickBooksVendor,
  fetchInactiveQuickBooksVendors,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
  getMyQBConnections,
  reactivateQuickBooksVendor,
  updateQuickBooksVendor,
} from "@/store/quickBooks/quickBooksApi";
import type { Vendor } from "@/store/quickBooks/quickBooksSlice";

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
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const vendorsLoading = useAppSelector((state) => state.quickBooks.vendorsLoading);
  const vendorsError = useAppSelector((state) => state.quickBooks.vendorsError);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);

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
  const [saving, setSaving] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const activeConnection = connections.find((c) => c._id === qbConnectionId) || connections[0];
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

  const openCreateSheet = () => {
    setEditingVendor(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setSheetVisible(true);
  };

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
            currency: form.currency,
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
          title="No company connected"
          description="Connect a QuickBooks company before managing vendors."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-[var(--space-lg)]">
      <div className="flex items-center justify-between gap-[var(--space-md)]">
        <div>
          <h1 className="text-h2 font-bold text-trust-navy">Vendors</h1>
          <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
            Manage vendors for {activeConnection.name}.
          </p>
        </div>
        {canManageVendors && (
          <Button onClick={openCreateSheet} size="sm" className="shrink-0">
            <Plus size={16} strokeWidth={2.5} />
            Add Vendor
          </Button>
        )}
      </div>

      {!canManageVendors && (
        <Card className="mt-[var(--space-md)] text-body-sm text-text-secondary">
          You have contributor access on {activeConnection.name} and can view vendors but not manage them.
        </Card>
      )}

      <div className="mt-[var(--space-lg)] flex gap-[var(--space-xs)] rounded-md bg-background-alt p-[var(--space-xs)]">
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
            return (
              <Card key={vendor._id} className="flex items-start justify-between gap-[var(--space-md)]">
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
                  <div className="flex shrink-0 items-center gap-[var(--space-xs)]">
                    {activeTab === "active" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditSheet(vendor)}
                          aria-label={`Edit ${vendor.displayName}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-background-alt"
                        >
                          <Pencil size={16} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeactivate(vendor)}
                          disabled={isDeactivating}
                          aria-label={`Deactivate ${vendor.displayName}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-error/10 text-error disabled:opacity-60"
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
                        className="flex h-8 items-center gap-[var(--space-xs)] rounded-md bg-primary/10 px-[var(--space-sm)] text-caption font-bold text-primary disabled:opacity-60"
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

      {sheetVisible && (
        <div className="fixed inset-0 z-50 flex cursor-pointer items-end justify-center bg-black/40 sm:items-center" onClick={closeSheet}>
          <div
            className="max-h-[90vh] w-full max-w-md cursor-auto overflow-y-auto rounded-t-2xl bg-white p-[var(--space-lg)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--space-md)] flex items-center justify-between">
              <h2 className="text-h3 font-bold text-text-primary">{editingVendor ? "Edit Vendor" : "Add Vendor"}</h2>
              <button type="button" onClick={closeSheet} aria-label="Close" className="text-text-secondary">
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
                  disabled={saving}
                  className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-white px-[var(--space-md)] text-body focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-body-sm font-semibold text-trust-navy">
                  GL account{!editingVendor && " *"}
                </label>
                <select
                  value={form.glAccountId}
                  onChange={(e) => setForm((f) => ({ ...f, glAccountId: e.target.value }))}
                  disabled={saving}
                  className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-white px-[var(--space-md)] text-body focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Select GL account</option>
                  {glAccounts.map((account) => (
                    <option key={account._id} value={account.qbAccountId}>
                      {account.name}
                    </option>
                  ))}
                </select>
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
