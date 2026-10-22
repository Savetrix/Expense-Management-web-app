// POST /api/bank-transactions/import — saves rows from a CSV file the browser
// has already parsed (components/v2/bankTransactions/csv.ts).
// Body: { accountName, rows: [{ date: "YYYY-MM-DD", description, amount }] },
// amount negative = money out.
import { bankContext, errorResponse, fail, json, readJson } from "@/lib/bankFeeds/http";
import { importCsv, listTransactions, type CsvRowIn } from "@/lib/bankFeeds/transactions";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 10_000;

export async function POST(request: Request) {
  const ctx = await bankContext(request, "code");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  const raw = Array.isArray(body?.rows) ? (body.rows as Record<string, unknown>[]) : null;
  if (!raw || raw.length === 0) return fail(400, "No rows to import.");
  if (raw.length > MAX_ROWS) return fail(400, `At most ${MAX_ROWS.toLocaleString()} rows per file.`);
  const rows: CsvRowIn[] = [];
  for (const r of raw) {
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : null;
    if (!date || amount === null) return fail(400, "Each row needs a date (YYYY-MM-DD) and an amount.");
    rows.push({ date, amount, description: typeof r.description === "string" ? r.description : "" });
  }
  try {
    const result = await importCsv(ctx.db, {
      qbConnectionId: ctx.connection.id,
      userId: ctx.caller.userId,
      accountLabel: typeof body?.accountName === "string" ? body.accountName : "Imported file",
      rows,
    });
    return json({ ...result, transactions: await listTransactions(ctx.db, ctx.connection.id) }, 201);
  } catch (error) {
    return errorResponse("import", error);
  }
}
