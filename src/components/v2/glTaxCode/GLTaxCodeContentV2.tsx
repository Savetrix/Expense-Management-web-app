"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Landmark, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { showToast } from "@/lib/dialogManager";
import { taxCodeId as getTaxCodeId, taxCodeName } from "@/lib/quickbooks/taxCode";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createQuickBooksAccount,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  getMyQBConnections,
  syncQuickBooksAccounts,
  syncQuickBooksTaxCodes,
} from "@/store/quickBooks/quickBooksApi";
import type { GLAccount, TaxCode } from "@/store/quickBooks/quickBooksSlice";
import { DataTable, Modal, PageHeader, RoleInfoBanner, SearchInput, Tabs } from "@/components/v2/ui";
import type { DataTableColumn } from "@/components/v2/ui";

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

const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

export function GLTaxCodeContentV2() {
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
  // create mode via /v2/gl-tax-codes?create=true — also forces the accounts
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
    router.replace("/v2/gl-tax-codes");
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

  const accountColumns: DataTableColumn<GLAccount>[] = [
    {
      key: "name",
      header: "Account name",
      width: "45%",
      render: (account) => <span className="block truncate py-[var(--space-sm)] font-bold text-content-primary">{account.name}</span>,
    },
    {
      key: "type",
      header: "Type",
      width: "30%",
      render: (account) => <span className="block truncate py-[var(--space-sm)] text-content-secondary">{account.accountType || "—"}</span>,
    },
    {
      key: "subtype",
      header: "Subtype",
      width: "25%",
      render: (account) => <span className="block truncate py-[var(--space-sm)] text-content-secondary">{account.accountSubType || "—"}</span>,
    },
  ];

  const taxCodeColumns: DataTableColumn<TaxCode>[] = [
    {
      key: "name",
      header: "Tax code",
      width: "40%",
      render: (code) => <span className="block truncate font-bold text-content-primary">{taxCodeName(code)}</span>,
    },
    {
      key: "rates",
      header: "Tax rates",
      width: "40%",
      render: (code) => (
        <span className="block truncate text-content-secondary">
          {code.taxRateIds && code.taxRateIds.length > 0 ? code.taxRateIds.map((r) => r.name).join(", ") : "—"}
        </span>
      ),
    },
    {
      key: "source",
      header: "",
      width: "20%",
      align: "right",
      render: () => <Badge variant="neutral">QuickBooks</Badge>,
    },
  ];

  if (loadingConnections) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (!activeConnection) {
    return (
      <div className="p-[var(--space-md)] sm:p-[var(--space-lg)]">
        <div className="rounded-lg border border-border bg-surface p-[var(--space-lg)] shadow-sm">
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
      </div>
    );
  }

  const currentLoading = activeTab === "accounts" ? accountsLoading : taxCodesLoading;
  const currentError = activeTab === "accounts" ? accountsError : taxCodesError;
  const currentCount = activeTab === "accounts" ? accounts.length : taxCodes.length;
  const currentFilteredCount = activeTab === "accounts" ? filteredAccounts.length : filteredTaxCodes.length;

  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="GL Account & TaxCode"
        subtitle={`Manage GL accounts and view tax codes for ${activeConnection.name}.`}
        action={
          <>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh from QuickBooks"
              title="Refresh from QuickBooks"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-content-primary transition-opacity hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={18} strokeWidth={2.25} className={refreshing ? "animate-spin" : ""} />
            </button>
            {canManage && activeTab === "accounts" && (
              <Button onClick={openCreateSheet} size="sm" className="shrink-0">
                <Plus size={16} strokeWidth={2.5} />
                Add GL Account
              </Button>
            )}
          </>
        }
      />

      {!canManage && (
        <div className="mt-[var(--space-md)]">
          <RoleInfoBanner>
            You have contributor access on {activeConnection.name} and can view GL accounts and tax codes but not create new
            ones.
          </RoleInfoBanner>
        </div>
      )}

      <div className="mt-[var(--space-lg)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-[var(--space-md)] border-b border-border bg-page p-[var(--space-md)] lg:flex-row lg:items-center ">
          <Tabs
            items={[
              { value: "accounts", label: "GL Accounts", count: accounts.length },
              { value: "taxCodes", label: "Tax Codes", count: taxCodes.length },
            ]}
            value={activeTab}
            onChange={(value) => setActiveTab(value as GLTab)}
          />
          {currentCount > 0 && (
            <SearchInput
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={activeTab === "accounts" ? "Search GL accounts…" : "Search tax codes…"}
              widthClassName="w-full lg:w-96"
            />
          )}
        </div>

        {currentLoading ? (
          <div className="p-[var(--space-md)]">
            <SkeletonListRows count={4} />
          </div>
        ) : currentError ? (
          <div className="p-[var(--space-md)]">
            <ErrorState message={currentError} onRetry={activeTab === "accounts" ? refetchAccounts : refetchTaxCodes} />
          </div>
        ) : currentCount === 0 ? (
          <EmptyState
            icon={activeTab === "accounts" ? <Landmark size={28} strokeWidth={1.75} /> : <BookOpen size={28} strokeWidth={1.75} />}
            title={activeTab === "accounts" ? "No GL accounts yet" : "No tax codes found"}
            description={
              activeTab === "accounts"
                ? "GL accounts sync automatically from QuickBooks, or add one manually."
                : "Tax codes come from your QuickBooks company's tax settings — set them up in QuickBooks to see them here."
            }
            actionLabel={activeTab === "accounts" && canManage ? "Add GL Account" : undefined}
            onAction={activeTab === "accounts" && canManage ? openCreateSheet : undefined}
          />
        ) : currentFilteredCount === 0 ? (
          <div className="p-[var(--space-lg)] text-center text-body-sm text-content-secondary">
            No {activeTab === "accounts" ? "GL accounts" : "tax codes"} match &quot;{searchText}&quot;.
          </div>
        ) : activeTab === "accounts" ? (
          <DataTable columns={accountColumns} rows={filteredAccounts} getRowKey={(a) => a._id} bordered={false} maxHeightClassName="max-h-[560px]" />
        ) : (
          <DataTable columns={taxCodeColumns} rows={filteredTaxCodes} getRowKey={(t) => getTaxCodeId(t)} bordered={false} maxHeightClassName="max-h-[560px]" />
        )}
      </div>

      <Modal
        open={sheetVisible}
        onClose={closeSheet}
        title="Add GL Account"
        footer={
          <Button onClick={handleSave} loading={saving} disabled={saving} className="w-full">
            Create GL account
          </Button>
        }
      >
        <div className="flex flex-col gap-[var(--space-md)]">
          <div>
            <label className={FIELD_LABEL_CLASS}>Account name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Office Rent"
              disabled={saving}
              className={FIELD_INPUT_CLASS}
            />
          </div>

          <div>
            <label className={FIELD_LABEL_CLASS}>Account type *</label>
            <select
              value={form.accountType}
              onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}
              disabled={saving}
              className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {GL_ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={FIELD_LABEL_CLASS}>Account subtype</label>
            <input
              value={form.accountSubType}
              onChange={(e) => setForm((f) => ({ ...f, accountSubType: e.target.value }))}
              placeholder="e.g. RentOrLeaseOfBuildings (optional)"
              disabled={saving}
              className={FIELD_INPUT_CLASS}
            />
          </div>

          {formError && <p className="text-caption font-semibold text-status-danger-text">{formError}</p>}
        </div>
      </Modal>
    </div>
  );
}
