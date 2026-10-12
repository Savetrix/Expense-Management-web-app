// Which accounting software a connection belongs to, and how to label it.
// The backend sends `provider` on every connection (GET /connections); rows
// cached before multi-provider support, or from an older backend, have none
// and are QuickBooks.

export type AccountingProviderId = "quickbooks" | "xero";

export interface ConnectionProvider {
  id: AccountingProviderId;
  name: string;
  capabilities?: {
    /** "void": deleting a posted invoice voids the bill instead of deleting it (Xero). */
    billDelete?: "hard" | "void";
    taxInclusiveLines?: boolean;
    attachments?: boolean;
  };
}

interface ProviderInfo {
  /** Short name for sentences: "Post to Xero". */
  name: string;
  /** Product name for connection rows: "QuickBooks Online". */
  productName: string;
  /** What the provider calls a company (singular / plural). */
  companyNoun: string;
  companyNounPlural: string;
  /** Label for the provider's company id (QB realmId, Xero tenantId). */
  companyIdLabel: string;
  /** Whether creating a GL account needs an account code. */
  accountCodeRequired: boolean;
  /** Whether the provider has a free-text account subtype (QB's detail type). */
  accountSubTypeSupported: boolean;
  /**
   * Account types a new GL account can be created as. Mirrors the backend
   * adapter's billableTypes — GET /accounts only returns these, so creating
   * any other type would be invisible in every account picker.
   */
  accountTypes: { value: string; label: string }[];
}

const asOptions = (values: string[]) => values.map((value) => ({ value, label: value }));

export const PROVIDERS: Record<AccountingProviderId, ProviderInfo> = {
  quickbooks: {
    name: "QuickBooks",
    productName: "QuickBooks Online",
    companyNoun: "company",
    companyNounPlural: "companies",
    companyIdLabel: "Realm ID",
    accountCodeRequired: false,
    accountSubTypeSupported: true,
    accountTypes: asOptions(["Expense", "Other Expense", "Cost of Goods Sold", "Fixed Asset", "Other Asset", "Other Current Asset"]),
  },
  xero: {
    name: "Xero",
    productName: "Xero",
    companyNoun: "organisation",
    companyNounPlural: "organisations",
    companyIdLabel: "Tenant ID",
    accountCodeRequired: true,
    accountSubTypeSupported: false,
    accountTypes: [
      { value: "EXPENSE", label: "Expense" },
      { value: "OVERHEADS", label: "Overhead" },
      { value: "DIRECTCOSTS", label: "Direct Costs" },
      { value: "FIXED", label: "Fixed Asset" },
      { value: "NONCURRENT", label: "Non-current Asset" },
      { value: "CURRENT", label: "Current Asset" },
      { value: "PREPAYMENT", label: "Prepayment" },
      { value: "INVENTORY", label: "Inventory" },
    ],
  },
};

export const DEFAULT_PROVIDER: AccountingProviderId = "quickbooks";

/** Any value → a known provider id, falling back to QuickBooks. */
export const asProviderId = (id: unknown): AccountingProviderId =>
  typeof id === "string" && Object.hasOwn(PROVIDERS, id) ? (id as AccountingProviderId) : DEFAULT_PROVIDER;

export const providerIdOf = (connection?: { provider?: Partial<ConnectionProvider> | null } | null): AccountingProviderId =>
  asProviderId(connection?.provider?.id);

export const providerInfoOf = (connection?: { provider?: Partial<ConnectionProvider> | null } | null): ProviderInfo =>
  PROVIDERS[providerIdOf(connection)];
