// Bill payments and approvals have no API yet. State is local and starts empty;
// approvers come from the real team members. Replace with real thunks once the
// backend endpoints exist (see the "(BE)" buttons).

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

export type { TeamPerson as TeamMember } from "../expenseClaims/useTeamMembers";

export interface ApprovalRules {
  enabled: boolean;
  mode: ApprovalMode;
  /** null until the user sets one — there is no default limit. */
  threshold: number | null;
  approverIds: string[];
}
