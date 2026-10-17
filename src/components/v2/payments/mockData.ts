// SAMPLE DATA ONLY — bill payments and approvals have no API yet. Everything on
// /payments runs on these records held in local React state; replace with real
// thunks once the backend endpoints exist (see the "(BE)" buttons).

export type BankDetailsSource = "invoice" | "contact";
export type BillStatus = "to_pay" | "awaiting_approval" | "in_run";
export type RunStatus = "waiting_authorisation" | "processing" | "paid" | "failed";
export type ApprovalMode = "every" | "above";

export interface BankDetails {
  accountName: string;
  accountNumber: string; // full number — only ever shown masked
  transitNumber: string;
  source: BankDetailsSource;
}

export interface PayVendor {
  id: string;
  name: string;
  bank: BankDetails;
  /** No payment has gone to this vendor from here yet — details must be confirmed. */
  firstPayment: boolean;
  /** Details on the latest invoice differ from the ones last paid to. */
  changedBank?: BankDetails;
}

export interface Bill {
  id: string;
  vendorId: string;
  reference: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  status: BillStatus;
  /** Set once an approver has signed off — the run skips the approval check. */
  approved?: boolean;
  approverId?: string;
  requestedAt?: string;
  requestedBy?: string;
  rejection?: { reason: string; by: string; at: string };
}

export interface RunBill {
  billId: string;
  vendorName: string;
  reference: string;
  amount: number;
}

export interface PaymentRun {
  id: string;
  date: string;
  bills: RunBill[];
  total: number;
  paidFromId: string;
  status: RunStatus;
  failureReason?: string;
}

export interface PayingAccount {
  id: string;
  name: string;
  mask: string;
  balance: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface ApprovalRules {
  enabled: boolean;
  mode: ApprovalMode;
  threshold: number;
  approverIds: string[];
}

export const MOCK_CURRENCY = "CAD";

export const MOCK_VENDORS: PayVendor[] = [
  {
    id: "pv-northwind",
    name: "Northwind Supplies",
    bank: { accountName: "Northwind Supplies Inc.", accountNumber: "004418826721", transitNumber: "10012", source: "contact" },
    firstPayment: false,
  },
  {
    id: "pv-brightline",
    name: "Brightline Logistics",
    bank: { accountName: "Brightline Logistics Ltd", accountNumber: "770192334580", transitNumber: "20456", source: "invoice" },
    firstPayment: true,
  },
  {
    id: "pv-acme",
    name: "Acme Office Furniture",
    bank: { accountName: "Acme Office Furniture", accountNumber: "551200987713", transitNumber: "30018", source: "contact" },
    firstPayment: false,
    changedBank: { accountName: "Acme Office Furniture Co", accountNumber: "882910045562", transitNumber: "41107", source: "invoice" },
  },
  {
    id: "pv-pixel",
    name: "Pixel Print Co.",
    bank: { accountName: "Pixel Print Company", accountNumber: "390055128840", transitNumber: "10012", source: "contact" },
    firstPayment: false,
  },
  {
    id: "pv-greenleaf",
    name: "Greenleaf Cleaning",
    bank: { accountName: "Greenleaf Cleaning Services", accountNumber: "612004779931", transitNumber: "50921", source: "invoice" },
    firstPayment: true,
  },
];

export const MOCK_BILLS: Bill[] = [
  { id: "b-1", vendorId: "pv-northwind", reference: "NW-20931", issueDate: "2026-09-12", dueDate: "2026-10-12", amount: 1240.5, status: "to_pay" },
  { id: "b-2", vendorId: "pv-northwind", reference: "NW-21007", issueDate: "2026-09-29", dueDate: "2026-10-29", amount: 386.0, status: "to_pay" },
  { id: "b-3", vendorId: "pv-brightline", reference: "BL-4471", issueDate: "2026-10-01", dueDate: "2026-10-31", amount: 2150.0, status: "to_pay" },
  { id: "b-4", vendorId: "pv-acme", reference: "ACM-1188", issueDate: "2026-09-20", dueDate: "2026-10-20", amount: 6400.0, status: "to_pay" },
  { id: "b-5", vendorId: "pv-pixel", reference: "PP-0932", issueDate: "2026-09-05", dueDate: "2026-10-05", amount: 512.75, status: "to_pay" },
  { id: "b-6", vendorId: "pv-greenleaf", reference: "GL-2026-10", issueDate: "2026-10-03", dueDate: "2026-11-02", amount: 890.0, status: "to_pay" },
  {
    id: "b-7",
    vendorId: "pv-northwind",
    reference: "NW-20877",
    issueDate: "2026-09-01",
    dueDate: "2026-10-01",
    amount: 9800.0,
    status: "awaiting_approval",
    approverId: "tm-priya",
    requestedAt: "2026-10-14",
    requestedBy: "Emma Wilson",
  },
];

export const MOCK_ACCOUNTS: PayingAccount[] = [
  { id: "ba-operating", name: "Operating account", mask: "4821", balance: 48210.33 },
  { id: "ba-reserve", name: "Reserve account", mask: "1934", balance: 125000.0 },
];

export const MOCK_RUNS: PaymentRun[] = [
  {
    id: "run-104",
    date: "2026-10-15",
    bills: [{ billId: "x-10", vendorName: "Pixel Print Co.", reference: "PP-0911", amount: 420.0 }],
    total: 420.0,
    paidFromId: "ba-operating",
    status: "waiting_authorisation",
  },
  {
    id: "run-103",
    date: "2026-10-10",
    bills: [
      { billId: "x-7", vendorName: "Northwind Supplies", reference: "NW-20790", amount: 1875.2 },
      { billId: "x-8", vendorName: "Northwind Supplies", reference: "NW-20812", amount: 640.0 },
      { billId: "x-9", vendorName: "Greenleaf Cleaning", reference: "GL-2026-09", amount: 890.0 },
    ],
    total: 3405.2,
    paidFromId: "ba-operating",
    status: "processing",
  },
  {
    id: "run-102",
    date: "2026-09-29",
    bills: [{ billId: "x-5", vendorName: "Acme Office Furniture", reference: "ACM-1104", amount: 2300.0 }],
    total: 2300.0,
    paidFromId: "ba-operating",
    status: "failed",
    failureReason: "The receiving bank rejected the account number. Check the vendor's bank details and retry.",
  },
  {
    id: "run-101",
    date: "2026-09-15",
    bills: [
      { billId: "x-1", vendorName: "Northwind Supplies", reference: "NW-20655", amount: 980.0 },
      { billId: "x-2", vendorName: "Pixel Print Co.", reference: "PP-0874", amount: 312.4 },
    ],
    total: 1292.4,
    paidFromId: "ba-reserve",
    status: "paid",
  },
];

export const MOCK_TEAM: TeamMember[] = [
  { id: "tm-priya", name: "Priya Shah", email: "priya@example.com", role: "Owner" },
  { id: "tm-daniel", name: "Daniel Okafor", email: "daniel@example.com", role: "Finance manager" },
  { id: "tm-emma", name: "Emma Wilson", email: "emma@example.com", role: "Accountant" },
];

export const MOCK_RULES: ApprovalRules = {
  enabled: true,
  mode: "above",
  threshold: 5000,
  approverIds: ["tm-priya"],
};
