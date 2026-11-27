// The tax code ScanTrix fills in next to an AI-filled GL account (24 Nov call,
// Saurabh may change it on Friday, so the rule lives here only):
//   1. the vendor's saved tax code;
//   2. else the tax code the company's similar posted items agree on: at least
//      3 items and at least 90% of them on the same code;
//   3. else blank.
// The AI never picks a tax code itself. Pure: the bank screen and tests use it.

export const TAX_MIN_ITEMS = 3;
export const TAX_MIN_SHARE = 0.9;

/** The code at least 3 items and 90% of all items agree on (an item without a code disagrees), else null. */
export function agreedTaxCode(codes: readonly (string | null | undefined)[]): string | null {
  if (codes.length < TAX_MIN_ITEMS) return null;
  const counts = new Map<string, number>();
  for (const c of codes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best && best[1] >= TAX_MIN_ITEMS && best[1] / codes.length >= TAX_MIN_SHARE ? best[0] : null;
}

export type PrefillTaxSource = "vendor" | "similar";

export function prefillTaxCode(args: { vendorTaxCodeId?: string | null; similarTaxCodes?: readonly (string | null)[] }): { taxCodeId: string; source: PrefillTaxSource } | null {
  if (args.vendorTaxCodeId) return { taxCodeId: args.vendorTaxCodeId, source: "vendor" };
  const agreed = agreedTaxCode(args.similarTaxCodes ?? []);
  return agreed ? { taxCodeId: agreed, source: "similar" } : null;
}
