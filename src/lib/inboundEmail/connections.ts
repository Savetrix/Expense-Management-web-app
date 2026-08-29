// SERVER-ONLY. Confirming, on the server, that a caller really owns the
// QuickBooks company they are asking to enable forwarding for.
//
// The browser sends a `qbConnectionId`. Taking it on trust would let any
// signed-in user mint a receiving address that posts invoices into a company
// they have no access to — the alias stores that id and later hands it straight
// to `POST /invoices` as `X-QB-Id`. So the id is checked against the caller's own
// connection list, using the caller's own token, and the company NAME is read
// from the backend's answer rather than from the request body.
//
// (The backend enforces its own authorization on every write regardless. This
// check exists so a bad id is refused at setup time with a clear message,
// instead of producing an address that silently fails on its first invoice.)
import { SAVETRIX_API_BASE_URL } from "./config";

const TIMEOUT_MS = 10_000;

export interface OwnedConnection {
  id: string;
  name: string;
  status: string | null;
}

export type ConnectionLookup =
  | { ok: true; connection: OwnedConnection }
  | { ok: false; reason: "not_found" | "not_connected" | "unauthenticated" | "unavailable" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `{ data: { connections: [...] } }`, per getMyQBConnections in quickBooksApi.ts. */
function readConnections(payload: unknown): OwnedConnection[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const candidates = [data?.connections, root?.connections, data, root].find((value) =>
    Array.isArray(value),
  );
  if (!Array.isArray(candidates)) return [];

  const out: OwnedConnection[] = [];
  for (const entry of candidates) {
    const item = asRecord(entry);
    if (!item) continue;
    const id = typeof item._id === "string" ? item._id : typeof item.id === "string" ? item.id : null;
    if (!id) continue;
    out.push({
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Company",
      status: typeof item.status === "string" ? item.status : null,
    });
  }
  return out;
}

export async function findOwnedConnection(
  accessToken: string,
  qbConnectionId: string,
): Promise<ConnectionLookup> {
  let response: Response;
  try {
    response = await fetch(`${SAVETRIX_API_BASE_URL}/qb-connections`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };

  const connections = readConnections(await response.json().catch(() => null));
  const match = connections.find((connection) => connection.id === qbConnectionId);
  if (!match) return { ok: false, reason: "not_found" };
  // A company whose QuickBooks link is broken cannot accept invoices, so
  // offering a working receiving address for it would be a lie — the address
  // would mint fine and then fail on the accountant's first real invoice.
  //
  // `reconnect_required` counts as broken. The settings panel already greys
  // both states out; the API refused only `disconnected`, so the two disagreed
  // and a direct call could create an address that was doomed on arrival.
  if (match.status === "disconnected" || match.status === "reconnect_required") {
    return { ok: false, reason: "not_connected" };
  }

  return { ok: true, connection: match };
}
