// Is this forwarding username available?
//
// The namespace is GLOBAL across invoice.scantrix.ai — every company, every
// account, the way a social handle works. That falls out of how aliases are
// stored: the document path IS a hash of the local part, so one address can
// exist exactly once across the whole deployment, and the create-only write
// that claims it is the uniqueness check. There is no separate index to keep
// in step.
//
// WHAT THIS ENDPOINT DISCLOSES, AND WHY THAT IS ACCEPTABLE.
// Answering "taken" or "free" tells the caller whether a given address exists.
// That is unavoidable for a handle picker, and it is tolerable here for the
// same reason §7 of the architecture doc gives: the address is an IDENTIFIER,
// not a credential. Knowing one buys nothing — mail from an unauthorised sender
// is discarded, so an enumerated address cannot be used to put anything in
// anyone's books. It is also sign-in gated, so this is not open to the internet.
//
// It does make address discovery easier for a spammer, which is a real (if
// small) cost. Rate limiting per account is the mitigation if that ever shows
// up in the metrics.
export const runtime = "nodejs";
export const maxDuration = 30;

import {
  checkUsernameShape,
  formatAliasAddress,
  normalizeUsername,
  resolveAliasHash,
  MAX_USERNAME_LENGTH,
} from "@/lib/inboundEmail/alias";
import { authorizeAliasRequest, storeFailure } from "@/lib/inboundEmail/apiAuth";
import { readAliasConfig } from "@/lib/inboundEmail/config";
import { readAlias } from "@/lib/inboundEmail/store";

/** Copy for each way a username cannot be delivered to. */
const SHAPE_MESSAGE: Record<string, string> = {
  empty: "Enter a username.",
  too_long: `Usernames can be at most ${MAX_USERNAME_LENGTH} characters.`,
  invalid_characters:
    "Use letters, numbers, dots, underscores, plus or hyphens. It must start and end with a letter or number.",
  reserved: "That username is reserved. Please choose another.",
};

export async function GET(request: Request) {
  const auth = await authorizeAliasRequest(request);
  if (!auth.ok) return auth.response;

  const config = readAliasConfig();
  if (!config.ok) {
    return Response.json({ error: "not_configured", missing: config.missing }, { status: 503 });
  }

  const raw = new URL(request.url).searchParams.get("username");
  const username = normalizeUsername(raw);

  const problem = checkUsernameShape(username);
  if (problem) {
    return Response.json(
      {
        username,
        available: false,
        reason: problem,
        message: SHAPE_MESSAGE[problem] ?? "That username can't be used.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // Resolve exactly as an inbound email would, so "available" here can never
  // mean something different from "deliverable" later.
  const hash = resolveAliasHash(username);
  if (!hash) {
    return Response.json(
      {
        username,
        available: false,
        reason: "invalid_characters",
        message: SHAPE_MESSAGE.invalid_characters,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const existing = await readAlias(hash);
    const mine = existing?.userId === auth.identity.userId;

    return Response.json(
      {
        username,
        address: formatAliasAddress(username, config.domain),
        available: existing === null,
        // A username already on one of the caller's OWN companies is still
        // unavailable — the client was explicit that one cannot be reused
        // across connections — but saying which case it is turns a dead end
        // into something the user can act on.
        reason: existing === null ? null : mine ? "taken_by_you" : "taken",
        message:
          existing === null
            ? "Available"
            : mine
              ? "You're already using this username for another company. Pick a variant, like adding a number."
              : "That username is taken. Try another.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return storeFailure(error, "username-check");
  }
}
