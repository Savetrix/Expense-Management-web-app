"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Landmark, Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { showToast } from "@/lib/dialogManager";
import { taxCodeId as getTaxCodeId, taxCodeLabel, taxCodeName } from "@/lib/quickbooks/taxCode";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createQuickBooksAccount,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  getMyQBConnections,
  syncQuickBooksAccounts,
  syncQuickBooksTaxCodes,
} from "@/store/quickBooks/quickBooksApi";

interface QBConnection {
  _id: string;
  name: string;
  realmId: string;
  role: string;
  createdAt: string;
}

type GLTab = "accounts" | "taxCodes";

// Mirrors account.service.js's INVOICE_GL_TYPES on the backend — GET
// /quickbooks/accounts only ever returns these types, so creating any other
// type would be invisible in every account picker in the app.
const GL_ACCOUNT_TYPES = [
  "Expense",
  "Other Expense",
  "Cost of Goods Sold",
  "Fixed Asset",
  "Other Asset",
  "Other Current Asset",
];

interface AccountFormState {
  name: string;
  accountType: string;
  accountSubType: string;
}

const EMPTY_ACCOUNT_FORM: AccountFormState = {
  name: "",
  accountType: GL_ACCOUNT_TYPES[0],
  accountSubType: "",
};

export function GLTaxCodeContent() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const accounts = useAppSelector((state) => state.quickBooks.accounts);
  const accountsLoading = useAppSelector((state) => state.quickBooks.accountsLoading);
  const accountsError = useAppSelector((state) => state.quickBooks.accountsError);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const taxCodesLoading = useAppSelector((state) => state.quickBooks.taxCodesLoading);
  const taxCodesError = useAppSelector((state) => state.quickBooks.taxCodesError);

  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connections, setConnections] = useState<QBConnection[]>([]);
  const [activeTab, setActiveTab] = useState<GLTab>("accounts");
  const [searchText, setSearchText] = useState("");

  const [sheetVisible, setSheetVisible] = useState(false);
  const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // With exactly one connected company there's nothing to choose, so use it
  // directly. With 2+, only use a match for an id the user actually
  // selected — the top-bar switcher starts blank when multiple companies are
  // connected, and this page shouldn't silently pick one on its own.
  const activeConnection = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const currentRole = activeConnection?.role || "";
  // Mirrors PERMISSIONS.REVIEW_EDIT_GL on the backend.
  const canManage = currentRole !== "" && currentRole !== "contributor";

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

  const refetchAccounts = useCallback(() => {
    if (!accessToken) return;
    dispatch(fetchQuickBooksAccounts({ accessToken }));
  }, [accessToken, dispatch]);

  const refetchTaxCodes = useCallback(() => {
    if (!accessToken) return;
    dispatch(fetchQuickBooksTaxCodes({ accessToken }));
  }, [accessToken, dispatch]);

  useEffect(() => {
    if (!accessToken || !activeConnection?._id) return;
    refetchAccounts();
    refetchTaxCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activeConnection?._id]);

  const filteredAccounts = useMemo(() => {
    if (!searchText.trim()) return accounts;
    const lower = searchText.toLowerCase();
    return accounts.filter((a) => a.name?.toLowerCase().includes(lower));
  }, [accounts, searchText]);

  const filteredTaxCodes = useMemo(() => {
    if (!searchText.trim()) return taxCodes;
    const lower = searchText.toLowerCase();
    return taxCodes.filter((t) => taxCodeName(t).toLowerCase().includes(lower));
  }, [taxCodes, searchText]);

  const openCreateSheet = () => {
    setForm(EMPTY_ACCOUNT_FORM);
    setFormError("");
    setSheetVisible(true);
  };

  // Lets the sidebar's "Create → GL Account" shortcut land straight in
  // create mode via /gl-tax-codes?create=true — also forces the accounts
  // tab active since the create button only ever shows there. Waits for
  // loadingConnections to resolve so canManage reflects the real role
  // before deciding whether to open it; runs at most once per page load.
  const autoOpenedCreateRef = useRef(false);
  useEffect(() => {
    if (autoOpenedCreateRef.current) return;
    if (searchParams.get("create") !== "true") return;
    if (loadingConnections) return;
    if (!canManage) return;
    autoOpenedCreateRef.current = true;
    setActiveTab("accounts");
    openCreateSheet();
    router.replace("/gl-tax-codes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadingConnections, canManage]);

  const closeSheet = () => {
    if (saving) return;
    setSheetVisible(false);
  };

  const handleSave = async () => {
    if (!accessToken) return;
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setFormError("Account name is required");
      return;
    }

    setFormError("");
    setSaving(true);
    try {
      const result = await dispatch(
        createQuickBooksAccount({
          accessToken,
          name: trimmedName,
          accountType: form.accountType,
          accountSubType: form.accountSubType.trim() || undefined,
        }),
      );
      if (createQuickBooksAccount.fulfilled.match(result)) {
        setSheetVisible(false);
        showToast(`${trimmedName} added.`, "success");
        refetchAccounts();
      } else {
        const payload = result.payload as { message?: string } | undefined;
        showToast(payload?.message || "Could not create GL account. Please try again.", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (!accessToken || refreshing) return;
    setRefreshing(true);
    try {
      const [accountsResult, taxCodesResult] = await Promise.all([
        dispatch(syncQuickBooksAccounts({ accessToken })),
        dispatch(syncQuickBooksTaxCodes({ accessToken })),
      ]);
      const accountsOk = syncQuickBooksAccounts.fulfilled.match(accountsResult);
      const taxCodesOk = syncQuickBooksTaxCodes.fulfilled.match(taxCodesResult);

      if (accountsOk || taxCodesOk) {
        refetchAccounts();
        refetchTaxCodes();
      }

      if (accountsOk && taxCodesOk) {
        showToast("GL accounts and tax codes refreshed from QuickBooks.", "success");
      } else if (accountsOk || taxCodesOk) {
        showToast("Refreshed, but one part failed. Try again to complete the sync.", "error");
      } else {
        const payload = (accountsResult.payload || taxCodesResult.payload) as { message?: string } | undefined;
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
          icon={<Landmark size={28} strokeWidth={1.75} />}
          title={connections.length > 0 ? "Select a company" : "No company connected"}
          description={
            connections.length > 0
              ? "Choose a company from the switcher up top to manage its GL accounts and tax codes."
              : "Connect a QuickBooks company before managing GL accounts and tax codes."
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-[var(--space-lg)]">
      <div className="flex flex-col gap-[var(--space-md)] lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-h2 font-bold text-trust-navy">GL Account &amp; TaxCode</h1>
          <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
            Manage GL accounts and view tax codes for {activeConnection.name}.
          </p>
        </div>
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
          {canManage && activeTab === "accounts" && (
            <Button onClick={openCreateSheet} size="sm" className="shrink-0">
              <Plus size={16} strokeWidth={2.5} />
              Add GL Account
            </Button>
          )}
        </div>
      </div>

      {!canManage && (
        <Card className="mt-[var(--space-md)] text-body-sm text-text-secondary">
          You have contributor access on {activeConnection.name} and can view GL accounts and tax codes but not create new ones.
        </Card>
      )}

      <div className="mt-[var(--space-lg)] flex gap-[var(--space-xs)] rounded-md bg-background-alt p-[var(--space-xs)]">
        <button
          type="button"
          onClick={() => setActiveTab("accounts")}
          aria-current={activeTab === "accounts" ? "page" : undefined}
          className={`flex-1 rounded-md px-[var(--space-sm)] py-[var(--space-sm)] text-body-sm font-semibold lg:py-[var(--space-xs)] ${
            activeTab === "accounts" ? "bg-white text-primary shadow-sm" : "text-text-secondary"
          }`}
        >
          GL Accounts ({accounts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("taxCodes")}
          aria-current={activeTab === "taxCodes" ? "page" : undefined}
          className={`flex-1 rounded-md px-[var(--space-sm)] py-[var(--space-sm)] text-body-sm font-semibold lg:py-[var(--space-xs)] ${
            activeTab === "taxCodes" ? "bg-white text-primary shadow-sm" : "text-text-secondary"
          }`}
        >
          Tax Codes ({taxCodes.length})
        </button>
      </div>

      {(activeTab === "accounts" ? accounts.length : taxCodes.length) > 0 && (
        <Input
          placeholder={activeTab === "accounts" ? "Search GL accounts…" : "Search tax codes…"}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="mt-[var(--space-md)] w-full"
        />
      )}

      <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)]">
        {activeTab === "accounts" ? (
          accountsLoading ? (
            <SkeletonListRows count={4} />
          ) : accountsError ? (
            <ErrorState message={accountsError} onRetry={refetchAccounts} />
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={<Landmark size={28} strokeWidth={1.75} />}
              title="No GL accounts yet"
              description="GL accounts sync automatically from QuickBooks, or add one manually."
              actionLabel={canManage ? "Add GL Account" : undefined}
              onAction={canManage ? openCreateSheet : undefined}
            />
          ) : filteredAccounts.length === 0 ? (
            <Card className="text-center text-body-sm text-text-secondary">No GL accounts match &quot;{searchText}&quot;.</Card>
          ) : (
            filteredAccounts.map((account) => (
              <Card key={account._id} className="flex items-center justify-between gap-[var(--space-md)]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-text-primary">{account.name}</p>
                  <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
                    {[account.accountType, account.accountSubType].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </Card>
            ))
          )
        ) : taxCodesLoading ? (
          <SkeletonListRows count={4} />
        ) : taxCodesError ? (
          <ErrorState message={taxCodesError} onRetry={refetchTaxCodes} />
        ) : taxCodes.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={28} strokeWidth={1.75} />}
            title="No tax codes found"
            description="Tax codes come from your QuickBooks company's tax settings — set them up in QuickBooks to see them here."
          />
        ) : filteredTaxCodes.length === 0 ? (
          <Card className="text-center text-body-sm text-text-secondary">No tax codes match &quot;{searchText}&quot;.</Card>
        ) : (
          filteredTaxCodes.map((code) => (
            <Card key={getTaxCodeId(code)} className="flex items-center justify-between gap-[var(--space-md)]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-text-primary">{taxCodeLabel(code)}</p>
                {code.taxRateIds && code.taxRateIds.length > 0 && (
                  <p className="mt-[var(--space-xs)] truncate text-caption text-text-secondary">
                    {code.taxRateIds.map((r) => r.name).join(", ")}
                  </p>
                )}
              </div>
              <Badge variant="neutral">QuickBooks</Badge>
            </Card>
          ))
        )}
      </div>

      {sheetVisible && (
        <div className="fixed inset-0 z-50 flex cursor-pointer items-end justify-center bg-black/40 sm:items-center" onClick={closeSheet}>
          <div
            className="max-h-[90vh] w-full max-w-md cursor-auto overflow-y-auto rounded-t-2xl bg-white p-[var(--space-lg)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--space-md)] flex items-center justify-between">
              <h2 className="text-h3 font-bold text-text-primary">Add GL Account</h2>
              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close"
                className="-m-[var(--space-sm)] p-[var(--space-sm)] text-text-secondary lg:m-0 lg:p-0"
              >
                <X size={20} strokeWidth={2.25} />
              </button>
            </div>

            <div className="flex flex-col gap-[var(--space-md)]">
              <Input
                label="Account name *"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Office Rent"
                disabled={saving}
              />

              <div>
                <label className="text-body-sm font-semibold text-trust-navy">Account type *</label>
                <select
                  value={form.accountType}
                  onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}
                  disabled={saving}
                  className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-white px-[var(--space-md)] text-body focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {GL_ACCOUNT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Account subtype"
                value={form.accountSubType}
                onChange={(e) => setForm((f) => ({ ...f, accountSubType: e.target.value }))}
                placeholder="e.g. RentOrLeaseOfBuildings (optional)"
                disabled={saving}
              />

              {formError && <p className="text-caption font-semibold text-error">{formError}</p>}

              <Button onClick={handleSave} loading={saving} disabled={saving} className="mt-[var(--space-xs)] w-full">
                Create GL account
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
