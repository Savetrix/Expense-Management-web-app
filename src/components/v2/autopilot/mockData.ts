// SAMPLE DATA ONLY — Autopilot has no backend yet. Everything on /autopilot
// renders from these fixtures until the Autopilot API exists; replace each
// export with the matching fetch once the endpoints land.

export type CheckId = "legibility" | "completeness" | "history";

export interface CheckResult {
  id: CheckId;
  passed: boolean;
  detail: string;
}

export type PublishedBy = "autopilot" | "person";

export interface AutopilotDocument {
  id: string;
  reference: string;
  vendor: string;
  documentType: "Invoice" | "Receipt" | "Credit note";
  /** ISO date printed on the document. */
  date: string;
  total: number;
  currency: string;
  glAccount: string;
  taxCode: string;
  uploadedBy: string;
  checks: CheckResult[];
  /** One-line, plain-language reason shown on the Needs review list. */
  reviewReason?: string;
  publishedBy?: PublishedBy;
  publishedByName?: string;
  /** ISO timestamp the document was published. */
  publishedAt?: string;
  trail: {
    read: string;
    compared: string;
    vendor: string;
  };
}

export const CHECK_LABELS: Record<CheckId, string> = {
  legibility: "Legibility",
  completeness: "Completeness",
  history: "Historical consistency",
};

const pass = (id: CheckId, detail: string): CheckResult => ({ id, passed: true, detail });
const fail = (id: CheckId, detail: string): CheckResult => ({ id, passed: false, detail });

export const NEEDS_REVIEW_DOCUMENTS: AutopilotDocument[] = [
  {
    id: "ap-r1",
    reference: "INV-88231",
    vendor: "Northside Packaging Ltd",
    documentType: "Invoice",
    date: "2026-10-14",
    total: 18450,
    currency: "CAD",
    glAccount: "Cost of Goods Sold",
    taxCode: "Standard 20%",
    uploadedBy: "Jane Doe",
    reviewReason: "Much larger than your usual order — about 6x the average of the last 8 invoices.",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      pass("completeness", "All required fields found and the lines add up to the total."),
      fail("history", "The amount is far outside this vendor's usual range, so the usual coding may not apply."),
    ],
    trail: {
      read: "Read the invoice twice. Both reads matched on date, due date, reference, total and 4 line items.",
      compared: "Found 8 earlier invoices from this vendor, all coded to Cost of Goods Sold with Standard 20%.",
      vendor: "Northside Packaging Ltd already exists in your accounting software.",
    },
  },
  {
    id: "ap-r2",
    reference: "R-2291",
    vendor: "Bean There Coffee",
    documentType: "Receipt",
    date: "2026-10-13",
    total: 42.6,
    currency: "CAD",
    glAccount: "Meals & Entertainment",
    taxCode: "Standard 20%",
    uploadedBy: "Marcus Lee",
    reviewReason: "The total is hard to read — the two reads disagree (42.60 vs 47.60).",
    checks: [
      fail("legibility", "The two reads disagree on the total: 42.60 and 47.60."),
      pass("completeness", "All required fields found."),
      pass("history", "12 earlier receipts agree on account, tax code and destination."),
    ],
    trail: {
      read: "Read the receipt twice. The total was faded and the reads disagreed on one digit.",
      compared: "12 earlier receipts from this vendor were coded to Meals & Entertainment.",
      vendor: "Bean There Coffee already exists in your accounting software.",
    },
  },
  {
    id: "ap-r3",
    reference: "4471-A",
    vendor: "Brightline Electrical",
    documentType: "Invoice",
    date: "2026-10-12",
    total: 2310,
    currency: "CAD",
    glAccount: "Repairs & Maintenance",
    taxCode: "Standard 20%",
    uploadedBy: "Jane Doe",
    reviewReason: "New vendor — not in your accounting software yet, and no past postings to compare.",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      fail("completeness", "The vendor doesn't exist yet in your accounting software."),
      fail("history", "No earlier postings for this vendor — at least 3 are needed."),
    ],
    trail: {
      read: "Read the invoice twice. Both reads matched.",
      compared: "No earlier postings found for this vendor. Suggested coding is based on similar vendors.",
      vendor: "Brightline Electrical was not found. It will be created when you publish.",
    },
  },
  {
    id: "ap-r4",
    reference: "SUB-10/26",
    vendor: "CloudDesk Software",
    documentType: "Invoice",
    date: "2026-10-10",
    total: 299,
    currency: "CAD",
    glAccount: "Software Subscriptions",
    taxCode: "No tax",
    uploadedBy: "Email inbox",
    reviewReason: "No due date on the document, and the tax code differs from the last 5 invoices.",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      fail("completeness", "No due date was found on the document."),
      fail("history", "The last 5 invoices used Standard 20%; this one shows no tax."),
    ],
    trail: {
      read: "Read the invoice twice. Both reads matched, but no due date was printed.",
      compared: "5 earlier invoices coded to Software Subscriptions with Standard 20%.",
      vendor: "CloudDesk Software already exists in your accounting software.",
    },
  },
];

export const AUTOPUBLISHED_DOCUMENTS: AutopilotDocument[] = [
  {
    id: "ap-p1",
    reference: "INV-77120",
    vendor: "Metro Office Supplies",
    documentType: "Invoice",
    date: "2026-10-15",
    total: 186.4,
    currency: "CAD",
    glAccount: "Office Supplies",
    taxCode: "Standard 20%",
    uploadedBy: "Email inbox",
    publishedBy: "autopilot",
    publishedAt: "2026-10-15T09:12:00Z",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      pass("completeness", "All required fields found and the lines add up to the total."),
      pass("history", "14 earlier invoices agree on vendor, account, tax code and destination."),
    ],
    trail: {
      read: "Read the invoice twice. Both reads matched on every field.",
      compared: "14 earlier invoices coded to Office Supplies with Standard 20%, posted as bills.",
      vendor: "Metro Office Supplies already exists in your accounting software.",
    },
  },
  {
    id: "ap-p2",
    reference: "UT-0925",
    vendor: "City Power & Water",
    documentType: "Invoice",
    date: "2026-10-14",
    total: 642.18,
    currency: "CAD",
    glAccount: "Utilities",
    taxCode: "Reduced 5%",
    uploadedBy: "Email inbox",
    publishedBy: "autopilot",
    publishedAt: "2026-10-14T16:40:00Z",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      pass("completeness", "All required fields found."),
      pass("history", "9 earlier invoices agree."),
    ],
    trail: {
      read: "Read the invoice twice. Both reads matched.",
      compared: "9 earlier invoices coded to Utilities with Reduced 5%.",
      vendor: "City Power & Water already exists in your accounting software.",
    },
  },
  {
    id: "ap-p3",
    reference: "88-1203",
    vendor: "FastFreight Couriers",
    documentType: "Invoice",
    date: "2026-10-13",
    total: 95,
    currency: "CAD",
    glAccount: "Postage & Delivery",
    taxCode: "Standard 20%",
    uploadedBy: "Marcus Lee",
    publishedBy: "person",
    publishedByName: "Marcus Lee",
    publishedAt: "2026-10-13T11:05:00Z",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      pass("completeness", "All required fields found."),
      fail("history", "Only 2 earlier postings — at least 3 are needed."),
    ],
    trail: {
      read: "Read the invoice twice. Both reads matched.",
      compared: "2 earlier invoices coded to Postage & Delivery.",
      vendor: "FastFreight Couriers already exists in your accounting software.",
    },
  },
  {
    id: "ap-p4",
    reference: "CN-0042",
    vendor: "Metro Office Supplies",
    documentType: "Credit note",
    date: "2026-10-11",
    total: 24.99,
    currency: "CAD",
    glAccount: "Office Supplies",
    taxCode: "Standard 20%",
    uploadedBy: "Jane Doe",
    publishedBy: "autopilot",
    publishedAt: "2026-10-11T08:30:00Z",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      pass("completeness", "All required fields found."),
      pass("history", "Matches the coding of 14 earlier documents from this vendor."),
    ],
    trail: {
      read: "Read the credit note twice. Both reads matched.",
      compared: "Coding matches 14 earlier documents from this vendor.",
      vendor: "Metro Office Supplies already exists in your accounting software.",
    },
  },
  {
    id: "ap-p5",
    reference: "R-55810",
    vendor: "Fuel Stop 24",
    documentType: "Receipt",
    date: "2026-10-09",
    total: 71.35,
    currency: "CAD",
    glAccount: "Motor Vehicle Expenses",
    taxCode: "Standard 20%",
    uploadedBy: "Priya Shah",
    publishedBy: "autopilot",
    publishedAt: "2026-10-09T19:22:00Z",
    checks: [
      pass("legibility", "Both reads agree on every field."),
      pass("completeness", "All required fields found."),
      pass("history", "21 earlier receipts agree."),
    ],
    trail: {
      read: "Read the receipt twice. Both reads matched.",
      compared: "21 earlier receipts coded to Motor Vehicle Expenses.",
      vendor: "Fuel Stop 24 already exists in your accounting software.",
    },
  },
];

export type MemoryStatus = "proposed" | "active";

export interface AiMemory {
  id: string;
  rule: string;
  scope: string;
  status: MemoryStatus;
  source: string;
}

export const MEMORY_SCOPES = ["All documents", "One vendor", "One uploader", "Receipts only"] as const;

export const AI_MEMORIES: AiMemory[] = [
  {
    id: "mem-1",
    rule: "When the uploader is Jane Doe, add \"JD\" to the end of the reference.",
    scope: "One uploader",
    status: "proposed",
    source: "Learned from 4 corrections",
  },
  {
    id: "mem-2",
    rule: "Coffee shop receipts go to Meals & Entertainment.",
    scope: "Receipts only",
    status: "active",
    source: "Learned from 7 corrections",
  },
  {
    id: "mem-3",
    rule: "Invoices from CloudDesk Software are always due 14 days after the invoice date.",
    scope: "One vendor",
    status: "proposed",
    source: "Learned from 3 corrections",
  },
  {
    id: "mem-4",
    rule: "Put the purchase order number in the description line, not the reference.",
    scope: "All documents",
    status: "active",
    source: "Added by you",
  },
];

export type UsageRange = "thisMonth" | "lastMonth" | "last90";

export const USAGE_RANGE_LABELS: Record<UsageRange, string> = {
  thisMonth: "This month",
  lastMonth: "Last month",
  last90: "Last 90 days",
};

export interface UsageRow {
  id: string;
  name: string;
  processed: number;
  published: number;
  autopublished: number;
  adjustments: number;
}

export const USAGE: Record<UsageRange, { companies: UsageRow[]; users: UsageRow[] }> = {
  thisMonth: {
    companies: [
      { id: "c1", name: "Acme Trading Co", processed: 214, published: 196, autopublished: 128, adjustments: 6 },
      { id: "c2", name: "Harbor Cafe Group", processed: 98, published: 90, autopublished: 41, adjustments: 3 },
      { id: "c3", name: "Pinecrest Dental", processed: 37, published: 31, autopublished: 9, adjustments: 1 },
    ],
    users: [
      { id: "u1", name: "Jane Doe", processed: 142, published: 133, autopublished: 88, adjustments: 4 },
      { id: "u2", name: "Marcus Lee", processed: 119, published: 104, autopublished: 59, adjustments: 5 },
      { id: "u3", name: "Priya Shah", processed: 88, published: 80, autopublished: 31, adjustments: 1 },
    ],
  },
  lastMonth: {
    companies: [
      { id: "c1", name: "Acme Trading Co", processed: 238, published: 231, autopublished: 139, adjustments: 9 },
      { id: "c2", name: "Harbor Cafe Group", processed: 104, published: 101, autopublished: 38, adjustments: 4 },
      { id: "c3", name: "Pinecrest Dental", processed: 29, published: 29, autopublished: 4, adjustments: 0 },
    ],
    users: [
      { id: "u1", name: "Jane Doe", processed: 160, published: 157, autopublished: 92, adjustments: 6 },
      { id: "u2", name: "Marcus Lee", processed: 131, published: 127, autopublished: 61, adjustments: 6 },
      { id: "u3", name: "Priya Shah", processed: 80, published: 77, autopublished: 28, adjustments: 1 },
    ],
  },
  last90: {
    companies: [
      { id: "c1", name: "Acme Trading Co", processed: 688, published: 664, autopublished: 371, adjustments: 24 },
      { id: "c2", name: "Harbor Cafe Group", processed: 301, published: 289, autopublished: 102, adjustments: 11 },
      { id: "c3", name: "Pinecrest Dental", processed: 66, published: 60, autopublished: 13, adjustments: 1 },
    ],
    users: [
      { id: "u1", name: "Jane Doe", processed: 452, published: 440, autopublished: 251, adjustments: 15 },
      { id: "u2", name: "Marcus Lee", processed: 371, published: 352, autopublished: 170, adjustments: 16 },
      { id: "u3", name: "Priya Shah", processed: 232, published: 221, autopublished: 65, adjustments: 5 },
    ],
  },
};
