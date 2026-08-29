// Receiving addresses: list the caller's, and create one for a company.
//
// Every path keys storage off the userId resolved by lib/inboundEmail/identity.ts
// on the server. Nothing in the body can widen that — a `userId` or `ownerEmail`
// in the payload is ignored, and the owner email is read from the backend's own
// view of the account (see identity.ts for why that matters so much: the owner
// email IS the sender allow-list).
export const runtime = "nodejs";
// Creation does a handful of upstream round trips (vouch, connection lookup,
// service login, invite + accept) plus two blob writes.
export const maxDuration = 60;

import { normalizeEmailAddress } from "@/lib/inboundEmail/address";
import { formatAliasAddress, mintAliasForCompany } from "@/lib/inboundEmail/alias";
import { readAliasConfig } from "@/lib/inboundEmail/config";
import { findOwnedConnection } from "@/lib/inboundEmail/connections";
import {
  ensureServiceMembership,
  getServiceAccessToken,
} from "@/lib/inboundEmail/serviceAccount";
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

  if (!qbConnectionId) {
    return Response.json({ error: "Choose a QuickBooks company first." }, { status: 400 });
  }
  // NOTE: no refreshToken is read here any more. Turning forwarding on used to
  // require delegating the caller's session; it now provisions a service member
  // instead, so the browser sends no credential at all.

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

  // ── Give the service account access to this company ──────────────────────
  // This is what replaced storing the accountant's own session. A dedicated
  // account is invited as a Contributor — the role the product defines as "can
  // upload and edit invoices only" — and it is what performs every inbound
  // upload from here on. See serviceAccount.ts for why a user's own session
  // could not work: this backend allows one live session per account, so the
  // stored credential and the person's browser destroyed each other.
  //
  // Done HERE, at enable time, because inviting requires the owner's token and
  // the owner is only present at this moment.
  const serviceToken = await getServiceAccessToken({
    email: config.serviceEmail,
    password: config.servicePassword,
  });
  if (!serviceToken.ok) {
    console.log(`[inbound] service login failed: ${serviceToken.reason}/${serviceToken.detail}`);
    return Response.json(
      {
        error:
          serviceToken.reason === "unauthorized"
            ? "Email forwarding is misconfigured on this deployment. Please contact support."
            : "Couldn't set up email forwarding right now. Please try again.",
        reason: serviceToken.detail,
      },
      { status: serviceToken.reason === "unauthorized" ? 500 : 503 },
    );
  }

  const membership = await ensureServiceMembership(
    auth.accessToken,
    serviceToken.accessToken,
    qbConnectionId,
    config.serviceEmail,
  );
  if (!membership.ok) {
    console.log(`[inbound] membership failed: ${membership.reason}`);
    return Response.json(
      {
        // Refusing here rather than minting an address that would silently fail
        // on the accountant's first real invoice.
        error:
          membership.reason === "not-authorized-to-invite"
            ? "Only an owner or admin of this company can turn on email forwarding."
            : "Couldn't set up email forwarding for this company. Please try again.",
        reason: membership.reason,
      },
      { status: membership.reason === "not-authorized-to-invite" ? 403 : 503 },
    );
  }

  // ── Whose mail may create invoices here ─────────────────────────────────
  // Server-side sources first (identity.ts tries /users/me, the token claims,
  // then /users/{id}). This backend exposes none of them, so in practice the
  // client-supplied address is what we get — accepted deliberately, and only
  // as a fallback. See identity.ts's ABOUT THE EMAIL note for why that is not
  // a privilege escalation: the owner can already add arbitrary additional
  // senders, and every boundary that matters is still verified above.
  const serverEmail = normalizeEmailAddress(auth.identity.email);
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
        // Nothing to store. Uploads are performed by the service account, so
        // no user credential is held anywhere for this alias.
        sealedRefreshToken: null,
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
