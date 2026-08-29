// SERVER-ONLY. The single door into the alias-management routes.
//
// Deliberately mirrors src/lib/chatHistory/apiAuth.ts: every route calls this
// first and uses nothing but its output, so the authorization rule lives in one
// place — no verified user id, no response.
import { resolveInboundIdentity, type InboundIdentity } from "./identity";
import { InboundStoreError, type AliasRecord } from "./store";

export interface AliasRequestContext {
  /** Verified server-side. Never derived from the path, query, or body. */
  identity: Extract<InboundIdentity, { kind: "authenticated" }>;
  /** The caller's own token, for upstream checks made on their behalf. */
  accessToken: string;
}

export type AliasAuthResult =
  | { ok: true; identity: AliasRequestContext["identity"]; accessToken: string }
  | { ok: false; response: Response };

export async function authorizeAliasRequest(request: Request): Promise<AliasAuthResult> {
  const accessToken = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();

  if (!accessToken) {
    return {
      ok: false,
      response: Response.json({ error: "Missing Authorization header." }, { status: 401 }),
    };
  }

  const outcome = await resolveInboundIdentity(accessToken);

  if (outcome.kind === "unauthenticated") {
    // Same shape/status the client already handles elsewhere, which trips
    // sessionEmitter's SESSION_EXPIRED and sends the user back to login.
    return {
      ok: false,
      response: Response.json({ error: "Session expired. Please sign in again." }, { status: 401 }),
    };
  }

  if (outcome.kind === "unavailable") {
    // Fail closed on a genuinely unknown caller. A missing EMAIL no longer
    // lands here — identity.ts returns it as null and the create route falls
    // back to a client-supplied address (see that file's ABOUT THE EMAIL note).
    console.log("[inbound] identity unavailable:", outcome.reason);
    return {
      ok: false,
      response: Response.json(
        { error: "Email forwarding settings are temporarily unavailable." },
        { status: 503 },
      ),
    };
  }

  return { ok: true, identity: outcome, accessToken };
}

/**
 * What a browser is allowed to see about an alias.
 *
 * The sealed refresh token is never included — not even in a redacted form. The
 * token hash is exposed because it is the resource identifier the routes address
 * (and it is a hash, not a credential), but nothing here lets a client
 * reconstruct the delegation.
 */
export interface PublicAlias {
  id: string;
  receivingAddress: string;
  companyName: string;
  qbConnectionId: string;
  active: boolean;
  rotationVersion: number;
  ownerEmail: string;
  additionalSenders: string[];
  /** Whether a usable delegation is stored. False means "needs reconnecting". */
  delegationActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function publicAlias(alias: AliasRecord): PublicAlias {
  return {
    id: alias.tokenHash,
    receivingAddress: alias.receivingAddress,
    companyName: alias.companyName,
    qbConnectionId: alias.qbConnectionId,
    active: alias.active,
    rotationVersion: alias.rotationVersion,
    ownerEmail: alias.ownerEmail,
    additionalSenders: alias.additionalSenders ?? [],
    delegationActive: Boolean(alias.sealedRefreshToken),
    createdAt: alias.createdAt,
    lastUsedAt: alias.lastUsedAt,
    revokedAt: alias.revokedAt,
  };
}

/** Store problems are transient by nature; 503 keeps them out of 500 dashboards. */
export function storeFailure(error: unknown, operation: string): Response {
  if (error instanceof InboundStoreError) {
    console.log(`[inbound] store ${operation} failed:`, error.message);
    return Response.json(
      { error: "Email forwarding settings are temporarily unavailable." },
      { status: 503 },
    );
  }
  console.log(
    `[inbound] ${operation} failed:`,
    error instanceof Error ? error.name : "unknown",
  );
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
