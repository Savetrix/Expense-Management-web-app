// One receiving address: revoke it, regenerate it, or change who may send to it.
//
// `id` is the alias's token hash. It appears in the URL, so OWNERSHIP IS CHECKED
// ON EVERY PATH — the record is loaded and its `userId` compared against the
// verified caller before anything is mutated. There is no request shape that
// widens the lookup: a hash belonging to someone else reads back as 404, the
// same answer a nonexistent one gets, so the routes cannot be used to discover
// which addresses exist.
export const runtime = "nodejs";
export const maxDuration = 60;

import { formatAliasAddress, mintAliasForCompany } from "@/lib/inboundEmail/alias";
import { readAliasConfig } from "@/lib/inboundEmail/config";
import { normalizeEmailAddress } from "@/lib/inboundEmail/address";
import { authorizeAliasRequest, publicAlias, storeFailure } from "@/lib/inboundEmail/apiAuth";
import { RefreshTokenAuthority } from "@/lib/inboundEmail/ingest";
import { resolveInboundIdentity } from "@/lib/inboundEmail/identity";
import { sealSecret } from "@/lib/inboundEmail/secretBox";
import {
  addAliasToUser,
  createAlias,
  deleteAlias,
  InboundWriteConflictError,
  readAlias,
  removeAliasFromUser,
  revokeAlias,
  updateAlias,
  type AliasRecord,
} from "@/lib/inboundEmail/store";

const MAX_BODY_BYTES = 20_000;
const MINT_ATTEMPTS = 5;
/** Extra senders per alias. Enough for a small team, small enough to review. */
const MAX_ADDITIONAL_SENDERS = 10;

const notFound = () =>
  Response.json({ error: "That receiving address was not found." }, { status: 404 });

/** Shape check before a store round trip: our ids are always sha256 hex. */
const isAliasId = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

/**
 * Load an alias the caller is allowed to act on, or the response to return.
 * A hash that exists but belongs to someone else is indistinguishable from one
 * that does not exist.
 */
async function loadOwned(
  request: Request,
  id: string,
): Promise<
  | { ok: true; alias: AliasRecord; userId: string; accessToken: string }
  | { ok: false; response: Response }
> {
  const auth = await authorizeAliasRequest(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!isAliasId(id)) return { ok: false, response: notFound() };

  const alias = await readAlias(id);
  if (!alias || alias.userId !== auth.identity.userId) {
    return { ok: false, response: notFound() };
  }
  return { ok: true, alias, userId: auth.identity.userId, accessToken: auth.accessToken };
}

// ==============================
// REVOKE
// ==============================

/**
 * Revocation is immediate and destroys the stored credential (store.revokeAlias),
 * not just the `active` flag: leaving a decryptable refresh token behind after
 * someone asked us to stop forwarding would be the wrong reading of "revoke".
 *
 * The record itself is kept (soft-revoked) so later mail to the address resolves
 * to `unknown_alias` and the audit trail survives. `?purge=true` removes it
 * outright, which also frees the address to be minted again.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await loadOwned(request, id);
  if (!owned.ok) return owned.response;

  const purge = new URL(request.url).searchParams.get("purge") === "true";

  try {
    if (purge) {
      await deleteAlias(owned.alias.tokenHash);
      await removeAliasFromUser(owned.userId, owned.alias.tokenHash);
      console.log("[inbound] alias purged");
      return Response.json({ status: "purged" });
    }

    const revoked = await revokeAlias(owned.alias.tokenHash);
    if (!revoked) return notFound();
    console.log("[inbound] alias revoked");
    return Response.json({ alias: publicAlias(revoked), status: "revoked" });
  } catch (error) {
    return storeFailure(error, "revoke");
  }
}

// ==============================
// REGENERATE / UPDATE SENDERS / RECONNECT
// ==============================

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await loadOwned(request, id);
  if (!owned.ok) return owned.response;

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
  const action = typeof payload.action === "string" ? payload.action : "";

  try {
    switch (action) {
      case "regenerate":
        return await regenerate(owned.alias, owned.userId, config.domain);
      case "senders":
        return await updateSenders(owned.alias, payload.additionalSenders);
      case "reconnect":
        return await reconnect(
          owned.alias,
          owned.userId,
          config.tokenEncryptionKey,
          payload.refreshToken,
        );
      default:
        return Response.json(
          { error: "Unknown action. Expected regenerate, senders, or reconnect." },
          { status: 400 },
        );
    }
  } catch (error) {
    return storeFailure(error, action || "patch");
  }
}

/**
 * Mint a new address for the same company and retire the old one.
 *
 * The OLD record is purged rather than soft-revoked, because the point of
 * regenerating is usually that the old address is being abused — leaving it
 * resolvable keeps a spam magnet alive. The delegated credential moves across,
 * re-sealed against the NEW token hash: the AAD binding means the old
 * ciphertext is not valid under the new alias, so it genuinely has to be
 * re-sealed rather than copied.
 */
async function regenerate(
  alias: AliasRecord,
  userId: string,
  domain: string,
): Promise<Response> {
  if (!alias.sealedRefreshToken) {
    return Response.json(
      { error: "Reconnect email forwarding for this company before regenerating its address." },
      { status: 409 },
    );
  }

  // Re-sealing needs the plaintext, so open it under the CURRENT alias's AAD.
  const config = readAliasConfig();
  if (!config.ok) {
    return Response.json({ error: "not_configured", missing: config.missing }, { status: 503 });
  }
  const { openSecret } = await import("@/lib/inboundEmail/secretBox");
  const refreshToken = openSecret(
    alias.sealedRefreshToken,
    config.tokenEncryptionKey,
    alias.tokenHash,
  );
  if (!refreshToken) {
    return Response.json(
      { error: "Stored session could not be read. Reconnect email forwarding for this company." },
      { status: 409 },
    );
  }

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
    const minted = mintAliasForCompany(alias.companyName);
    const next: AliasRecord = {
      ...alias,
      tokenHash: minted.tokenHash,
      localPart: minted.localPart,
      receivingAddress: formatAliasAddress(minted.localPart, domain),
      companySlug: minted.slug,
      active: true,
      rotationVersion: alias.rotationVersion + 1,
      sealedRefreshToken: sealSecret(refreshToken, config.tokenEncryptionKey, minted.tokenHash),
      createdAt: new Date().toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    };

    try {
      await createAlias(next);
    } catch (error) {
      if (error instanceof InboundWriteConflictError) continue;
      throw error;
    }

    // New address is live before the old one goes away, so there is no window
    // in which the company has no working address.
    await addAliasToUser(userId, next.tokenHash);
    await deleteAlias(alias.tokenHash);
    await removeAliasFromUser(userId, alias.tokenHash);
    console.log(`[inbound] alias regenerated rotation=${next.rotationVersion}`);
    return Response.json({ alias: publicAlias(next), status: "regenerated" });
  }

  return Response.json({ error: "Couldn't allocate an address. Please try again." }, { status: 503 });
}

/**
 * Replace the extra-senders list.
 *
 * Every entry is RFC-parsed and normalized before storage, so the allow-list
 * holds canonical addresses and the runtime comparison in pipeline.ts is a
 * straight match rather than a fuzzy one. Anything unparseable is refused with
 * the offending value echoed, because a silently dropped sender would look like
 * it had been added.
 */
async function updateSenders(alias: AliasRecord, raw: unknown): Promise<Response> {
  if (!Array.isArray(raw)) {
    return Response.json({ error: "additionalSenders must be an array." }, { status: 400 });
  }
  if (raw.length > MAX_ADDITIONAL_SENDERS) {
    return Response.json(
      { error: `At most ${MAX_ADDITIONAL_SENDERS} additional senders.` },
      { status: 400 },
    );
  }

  const normalized: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const address = normalizeEmailAddress(entry);
    if (!address) {
      return Response.json({ error: `"${entry.slice(0, 80)}" is not a valid email address.` }, { status: 400 });
    }
    const lowered = address.toLowerCase();
    // The owner is always authorized; listing them again would be noise.
    if (lowered === normalizeEmailAddress(alias.ownerEmail)?.toLowerCase()) continue;
    if (!normalized.some((existing) => existing.toLowerCase() === lowered)) normalized.push(address);
  }

  const updated = await updateAlias(alias.tokenHash, (current) => ({
    ...current,
    additionalSenders: normalized,
  }));
  if (!updated) return notFound();
  return Response.json({ alias: publicAlias(updated), status: "updated" });
}

/**
 * Re-delegate after the stored credential died (`credential_expired`).
 *
 * Same two proofs the create path requires: the token must work, and it must
 * belong to this caller. Re-verified here rather than trusted, because this is
 * precisely the path someone would use to swap in a credential that is not
 * theirs.
 */
async function reconnect(
  alias: AliasRecord,
  userId: string,
  encryptionKey: Buffer,
  raw: unknown,
): Promise<Response> {
  const refreshToken = typeof raw === "string" ? raw.trim() : "";
  if (!refreshToken) {
    return Response.json(
      { error: "Your session could not be delegated. Sign out, sign in again, and retry." },
      { status: 400 },
    );
  }

  const authority = new RefreshTokenAuthority(encryptionKey);
  const probe = await authority.mintAccessToken(
    sealSecret(refreshToken, encryptionKey, "probe"),
    "probe",
  );
  if (!probe.ok) {
    if (probe.reason === "credential_expired") {
      return Response.json(
        { error: "Your session could not be delegated. Sign out, sign in again, and retry." },
        { status: 400 },
      );
    }
    return Response.json({ error: "Couldn't verify your session. Please try again." }, { status: 503 });
  }

  const delegated = await resolveInboundIdentity(probe.accessToken);
  if (delegated.kind !== "authenticated" || delegated.userId !== userId) {
    return Response.json(
      { error: "That session does not match your account. Sign in again and retry." },
      { status: 403 },
    );
  }

  const updated = await updateAlias(alias.tokenHash, (current) => ({
    ...current,
    active: true,
    revokedAt: null,
    // Refresh the owner email only when the backend actually told us one. On a
    // backend that cannot (see identity.ts), keep whatever the alias already
    // holds rather than blanking a working allow-list on a reconnect.
    ...(delegated.email
      ? { ownerEmail: delegated.email, ownerEmailVerified: true }
      : {}),
    sealedRefreshToken: sealSecret(refreshToken, encryptionKey, current.tokenHash),
  }));
  if (!updated) return notFound();

  console.log("[inbound] alias reconnected");
  return Response.json({ alias: publicAlias(updated), status: "reconnected" });
}
