// Which of the caller's invoices arrived by email.
//
// Exists because the backend cannot answer this. Emailed invoices are posted
// through the SAME `POST /invoices` the Upload button uses — deliberately, so
// there is exactly one ingestion path (§22) — which means there is no `source`
// column upstream to read. We know the answer only because we created those
// invoices, so the "Email" badge is served from our own record here.
//
// Cheap by design: one blob read, ids only. Nothing about the invoices
// themselves is stored or returned.
export const runtime = "nodejs";
export const maxDuration = 30;

import { authorizeAliasRequest, storeFailure } from "@/lib/inboundEmail/apiAuth";
import { readUserRecord } from "@/lib/inboundEmail/store";

export async function GET(request: Request) {
  const auth = await authorizeAliasRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const record = await readUserRecord(auth.identity.userId);
    return Response.json(
      { emailInvoiceIds: record.emailInvoiceIds ?? [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return storeFailure(error, "sources");
  }
}
