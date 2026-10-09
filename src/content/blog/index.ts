// The blog's post registry.
//
// To publish a post: copy an existing file in this folder, rename it to the new
// slug, edit it, and add one import + one array entry below. The order here
// only breaks ties between posts published on the same day; the blog sorts by
// date. The test suite fails if a file in this folder is not registered here.
//
// Writing rules live in src/lib/blog.ts (validatePostSource) and are enforced at
// build time. Product claims must match the code — see SEO-AUDIT.md §3.
import type { BlogPostSource } from "@/lib/blog";

import { post as clearMonthEndAccountsPayableBacklog } from "./clear-month-end-accounts-payable-backlog";
import { post as enterBillsIntoQuickBooksOnlineFaster } from "./enter-bills-into-quickbooks-online-faster";
import { post as forwardSupplierInvoicesToQuickBooksByEmail } from "./forward-supplier-invoices-to-quickbooks-by-email";

export const POST_SOURCES: readonly BlogPostSource[] = [
  enterBillsIntoQuickBooksOnlineFaster,
  clearMonthEndAccountsPayableBacklog,
  forwardSupplierInvoicesToQuickBooksByEmail,
];
