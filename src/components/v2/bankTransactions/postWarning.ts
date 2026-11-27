// "Post" on a line with no receipt (Saurabh, 24 Nov): a warning, never a block.
// One popup per click: a single line asks "Post it anyway?"; several lines get
// one popup that says how many have nothing attached. A match (the bill is the
// document) or a transfer never asks. Blocking problems stay inline and red.
import type { BankTransaction } from "./types";

export interface PostItem {
  txn: Pick<BankTransaction, "amount" | "attachments" | "matchedInvoiceId">;
  patch: Partial<BankTransaction>;
}

export interface PostDialog {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** Lines this Post turns into an expense with nothing attached. */
export function withoutReceipt(items: readonly PostItem[]): number {
  return items.filter(({ txn, patch }) => (patch.status ?? "ready") === "ready" && txn.amount < 0 && !txn.attachments?.length && !txn.matchedInvoiceId).length;
}

/** The one popup before posting, or null when nothing needs saying. */
export function postDialog(items: readonly PostItem[], opts: { providerName: string; sendsNow: boolean; warnReceipts: boolean }): PostDialog | null {
  const n = items.length;
  if (n === 0) return null;
  const missing = opts.warnReceipts ? withoutReceipt(items) : 0;
  if (n === 1) {
    return missing
      ? { title: "No receipt attached", message: "No receipt or invoice is attached to this line. Post it anyway?", confirmLabel: "Post anyway", cancelLabel: "Go back" }
      : null;
  }
  const sent = opts.sendsNow ? ` A sent line can only be changed in ${opts.providerName}.` : "";
  const none = missing ? ` ${missing} of them ${missing === 1 ? "has" : "have"} no receipt or invoice attached.` : "";
  return {
    title: `Post ${n} lines${opts.sendsNow ? ` to ${opts.providerName}` : ""}?`,
    message: `Each line is posted with the vendor, GL account and tax code it shows.${sent}${none}`,
    confirmLabel: missing ? "Post anyway" : `Post ${n}`,
    cancelLabel: "Go back",
  };
}

/** Asks once if needed, then posts once. Returns false when the person went back (nothing posted). */
export async function confirmThenPost<T extends PostItem>(
  items: T[],
  opts: { providerName: string; sendsNow: boolean; warnReceipts: boolean },
  ask: (d: PostDialog) => Promise<boolean>,
  post: (items: T[]) => unknown,
): Promise<boolean> {
  const d = postDialog(items, opts);
  if (d && !(await ask(d))) return false;
  await post(items);
  return true;
}
