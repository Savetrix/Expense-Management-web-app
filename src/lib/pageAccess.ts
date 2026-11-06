// Which sidebar pages a contributor may open. The owner of a company picks
// them on invite (Team page); null/absent = every page. Keys are the pages'
// routes and must match the backend's PAGE_KEYS (Scantrix_API
// src/constants/pages.js). Profile and preferences are always open, and the
// superadmin page is never a member's.

export const PAGE_ACCESS_OPTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "invoices", label: "Invoices" },
  { key: "bank-transactions", label: "Bank Transactions" },
  { key: "expense-claims", label: "Expense Claims" },
  { key: "team", label: "Team" },
  { key: "vendors", label: "Vendors" },
  { key: "gl-tax-codes", label: "GL Account & TaxCode" },
  { key: "accounting-software", label: "Integrations" },
  { key: "subscription", label: "Subscription" },
] as const;

export type PageKey = (typeof PAGE_ACCESS_OPTIONS)[number]["key"];
export const ALL_PAGE_KEYS: PageKey[] = PAGE_ACCESS_OPTIONS.map((p) => p.key);

// Pages reached from a sidebar page rather than the sidebar itself: they
// follow that page's access.
const PAGE_ALIASES: Record<string, PageKey> = {
  quickbooks: "accounting-software",
  "google-drive": "accounting-software",
  onedrive: "accounting-software",
  plans: "subscription",
};

/** The page key a path belongs to ("/invoices/123/review" → "invoices"), or null for pages that are always open. */
export function pageKeyOf(pathname: string): PageKey | null {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  if ((ALL_PAGE_KEYS as string[]).includes(first)) return first as PageKey;
  return PAGE_ALIASES[first] ?? null;
}

/** Whether someone with this role and page list may open the page. Only contributors are ever restricted. */
export function canOpenPage(role: string | undefined, pageAccess: string[] | null | undefined, key: PageKey | null): boolean {
  if (!key || role !== "contributor" || !pageAccess) return true;
  return pageAccess.includes(key);
}
