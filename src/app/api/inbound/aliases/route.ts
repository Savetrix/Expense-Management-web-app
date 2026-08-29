// Receiving addresses: list the caller's, and create one for a company.
//
// Every path keys storage off the userId resolved by lib/inboundEmail/identity.ts
// on the server. Nothing in the body can widen that — a `userId` or `ownerEmail`
// in the payload is ignored, and the owner email is read from the backend's own
// view of the account (see identity.ts for why that matters so much: the owner
// email IS the sender allow-list).
export const runtime = "nodejs";
// Creation does a handful of upstream round trips (vouch, connection lookup,
// token exchange) plus two blob writes.
export const maxDuration = 60;

import { normalizeEmailAddress } from "@/lib/inboundEmail/address";
import { formatAliasAddress, mintAliasForCompany } from "@/lib/inboundEmail/alias";
import { readAliasConfig } from "@/lib/inboundEmail/config";
import { findOwnedConnection } from "@/lib/inboundEmail/connections";
import { resolveInboundIdentity } from "@/lib/inboundEmail/identity";
import { RefreshTokenAuthority } from "@/lib/inboundEmail/ingest";
import { sealSecret } from "@/lib/inboundEmail/secretBox";
import {
  addAliasToUser,
  createAlias,
  InboundWriteConflictError,
  listUserAliases,
  readUserRecord,
  type AliasRecord,
} from "@/lib/inboundEmail/store";
import {
  authorizeAliasRequest,
  publicAlias,
  storeFailure,
} from "@/lib/inboundEmail/apiAuth";

const MAX_BODY_BYTES = 20_000;
/** Fresh suffixes to try before giving up on a unique-index collision (§7). */
const MINT_ATTEMPTS = 5;

export async function GET(request: Request) {
  const auth = await authorizeAliasRequest(request);
  if (!auth.ok) return auth.response;

  const config = readAliasConfig();
  if (!config.ok) {
    // Report the misconfiguration rather than an empty list: "you have no
    // addresses" and "this deployment cannot make addresses" are different
    // answers, and the settings screen says so.
    return Response.json(
      { error: "not_configured", missing: config.missing },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const [aliases, record] = await Promise.all([
      listUserAliases(auth.identity.userId),
      readUserRecord(auth.identity.userId),
    ]);

    return Response.json(
      {
        enabled: config.enabled,
        domain: config.domain,
        aliases: aliases.map(publicAlias),
        recentActivity: record.recentActivity,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return storeFailure(error, "list");
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAliasRequest(request);
  if (!auth.ok) return auth.response;

  const config = readAliasConfig();
  if (!config.ok) {
    return Response.json({ error: "not_configured", missing: config.missing }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const qbConnectionId = typeof payload.qbConnectionId === "string" ? payload.qbConnectionId.trim() : "";
  const refreshToken = typeof payload.refreshToken === "string" ? payload.refreshToken.trim() : "";

  if (!qbConnectionId) {
    return Response.json({ error: "Choose a QuickBooks company first." }, { status: 400 });
  }
  if (!refreshToken) {
    // The delegated credential is what makes ingestion possible at all; there is
    // no useful half-configured state to store.
    return Response.json(
      { error: "Your session could not be delegated. Sign out, sign in again, and retry." },
      { status: 400 },
    );
  }

  // ── The caller must actually own this company ────────────────────────────
  const lookup = await findOwnedConnection(auth.accessToken, qbConnectionId);
  if (!lookup.ok) {
    if (lookup.reason === "unauthenticated") {
      return Response.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    }
    if (lookup.reason === "not_found") {
      return Response.json(
        { error: "That QuickBooks company is not available on your account." },
        { status: 403 },
      );
    }
    return Response.json({ error: "Couldn't reach QuickBooks. Please try again." }, { status: 503 });
  }

  // ── Prove the delegation works BEFORE promising the user it does ─────────
  // Two things are being established here, and both matter:
  //   1. The refresh token is valid and can mint an access token. Storing an
  //      unusable credential would produce an address that looks live and fails
  //      silently on the accountant's first real invoice.
  //   2. The credential belongs to THIS caller. Without this, someone could
  //      paste another user's refresh token and have their own alias post
  //      invoices under that user's identity.
  const authority = new RefreshTokenAuthority(config.tokenEncryptionKey);
  const probeSeal = sealSecret(refreshToken, config.tokenEncryptionKey, "probe");
  const minted = await authority.mintAccessToken(probeSeal, "probe");
  if (!minted.ok) {
    // Structural only — a status code, never the token or the response body.
    console.log(`[inbound] delegation probe failed: ${minted.reason}/${minted.detail}`);
    if (minted.reason === "credential_expired") {
      // The detail is echoed because this is the authenticated owner asking
      // about their own session, and "refresh-404" (wrong path) versus
      // "refresh-401" (refused token) are opposite problems — one is a
      // deployment bug, the other is genuinely "sign in again".
      return Response.json(
        {
          error:
            minted.detail === "refresh-404" || minted.detail === "refresh-405"
              ? "The sign-in service didn't recognise the refresh endpoint. This is a configuration problem, not your account."
              : "Your session could not be delegated. Sign out, sign in again, and retry.",
          reason: minted.detail,
        },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Couldn't verify your session. Please try again.", reason: minted.detail },
      { status: 503 },
    );
  }

  const delegated = await resolveInboundIdentity(minted.accessToken);
  if (delegated.kind !== "authenticated" || delegated.userId !== auth.identity.userId) {
    return Response.json(
      { error: "That session does not match your account. Sign in again and retry." },
      { status: 403 },
    );
  }

  // ── Whose mail may create invoices here ─────────────────────────────────
  // Server-side sources first (identity.ts tries /users/me, the token claims,
  // then /users/{id}). This backend exposes none of them, so in practice the
  // client-supplied address is what we get — accepted deliberately, and only
  // as a fallback. See identity.ts's ABOUT THE EMAIL note for why that is not
  // a privilege escalation: the owner can already add arbitrary additional
  // senders, and every boundary that matters is still verified above.
  const serverEmail = normalizeEmailAddress(delegated.email ?? auth.identity.email);
  const claimedEmail = normalizeEmailAddress(
    typeof payload.ownerEmail === "string" ? payload.ownerEmail : null,
  );
  const ownerEmail = serverEmail ?? claimedEmail;

  if (!ownerEmail) {
    return Response.json(
      {
        error:
          "We couldn't determine your account email, which is needed to decide whose forwarded mail is accepted. Sign out and sign in again, then retry.",
      },
      { status: 400 },
    );
  }

  // ── Mint the address ────────────────────────────────────────────────────
  try {
    const existing = await listUserAliases(auth.identity.userId);
    const already = existing.find(
      (alias) => alias.qbConnectionId === qbConnectionId && alias.active,
    );
    if (already) {
      // Idempotent: enabling twice returns the existing address rather than
      // minting a second one, so a double-click cannot leave a company with two
      // live addresses.
      return Response.json({ alias: publicAlias(already), created: false }, { status: 200 });
    }

    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const minta = mintAliasForCompany(lookup.connection.name);
      const record: AliasRecord = {
        version: 1,
        tokenHash: minta.tokenHash,
        localPart: minta.localPart,
        receivingAddress: formatAliasAddress(minta.localPart, config.domain),
        userId: auth.identity.userId,
        ownerEmail,
        /** False when the address came from the client, not the backend. */
        ownerEmailVerified: serverEmail !== null,
        additionalSenders: [],
        qbConnectionId,
        companyName: lookup.connection.name,
        companySlug: minta.slug,
        active: true,
        rotationVersion: 1,
        // Bound to this alias's token hash as AAD, so the sealed credential
        // cannot be moved to another alias (secretBox.ts).
        sealedRefreshToken: sealSecret(refreshToken, config.tokenEncryptionKey, minta.tokenHash),
        createdAt: new Date().toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      };

      try {
        await createAlias(record);
        await addAliasToUser(auth.identity.userId, record.tokenHash);
        console.log(`[inbound] alias created rotation=1 company=${lookup.connection.id}`);
        return Response.json({ alias: publicAlias(record), created: true }, { status: 201 });
      } catch (error) {
        // A create-only conflict means this suffix is taken. Re-mint with a
        // fresh one rather than overwriting somebody else's address — the
        // collision-safety property §7 claims.
        if (error instanceof InboundWriteConflictError) continue;
        throw error;
      }
    }

    return Response.json(
      { error: "Couldn't allocate an address. Please try again." },
      { status: 503 },
    );
  } catch (error) {
    return storeFailure(error, "create");
  }
}
