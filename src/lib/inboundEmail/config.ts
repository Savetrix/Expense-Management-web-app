// SERVER-ONLY. Environment configuration for inbound email ingestion.
//
// Every value here is server-only. None may ever take a NEXT_PUBLIC_ prefix: a
// NEXT_PUBLIC_ variable is inlined into the browser bundle, which would publish
// the webhook signing secret, the provider API key, and the key that encrypts
// stored refresh tokens.
//
// Reading config is separated from using it so a misconfiguration produces one
// clear diagnostic ("which variables are missing") instead of a confusing
// failure deep inside the pipeline. The webhook answers 503 on a config problem
// — which is retryable — so mail queued at the provider survives a deploy that
// forgot a variable, and replays once it is set.
import { DEFAULT_LIMITS, type AttachmentLimits } from "./attachment";

/** Same env var + fallback as src/lib/api.ts. Never hardcode a new URL inline. */
export const SAVETRIX_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://api.savetrix.com/api";

export interface InboundEmailConfig {
  /** Global kill switch. When false the webhook records and does no work. */
  enabled: boolean;
  provider: "resend";
  /**
   * Receiving domain. A Resend-managed `<id>.resend.app` subdomain needs no DNS
   * at all; `invoice.scantrix.ai` needs an MX record. Switching between them is
   * this one variable — see EMAIL_FORWARDING_DEPLOY.md.
   */
  domain: string;
  providerApiKey: string;
  webhookSigningSecret: string;
  toleranceSeconds: number;
  /**
   * Reject when no SPF/DKIM/DMARC verdict can be established. Default FALSE,
   * which is a deliberate reversal of the original design's default: Resend's
   * inbound webhook carries no authentication results at all (verified against
   * their API reference), so verdicts have to be parsed out of the
   * `Authentication-Results` header we fetch separately. Defaulting to `true`
   * before anyone has confirmed that header actually arrives would reject every
   * message with `authentication_failed` and make a working feature look broken.
   *
   * The real gate is the verified-registered-sender check in authorization.ts,
   * not this flag. Flip it to `true` once the diagnostics panel confirms the
   * header is present — see the deploy runbook.
   */
  requireEmailAuth: boolean;
  limits: AttachmentLimits;
  retentionDays: number;
  /** AES-256-GCM key for secrets at rest. 32 bytes, base64 or hex. */
  tokenEncryptionKey: Buffer;
  /**
   * The dedicated Scantrix account that performs every inbound upload.
   *
   * WHY A SERVICE ACCOUNT AND NOT THE USER'S OWN SESSION. This backend allows
   * exactly ONE live session per account — a second login invalidates the
   * first's refresh token (verified against the live API). Storing a user's
   * session therefore meant the delegation died every time that person signed
   * in anywhere, and using it logged them out. The two competed for one slot.
   *
   * A dedicated account that no human ever signs into has no such competition.
   * It is invited as a **Contributor** to each forwarding-enabled company —
   * the role the product itself defines as "can upload and edit invoices only"
   * — so it holds exactly the authority this feature needs and nothing more.
   */
  serviceEmail: string;
  servicePassword: string;
}

export type ConfigOutcome =
  | { ok: true; config: InboundEmailConfig }
  | { ok: false; missing: string[]; detail?: string };

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Booleans from env are a classic footgun: `Boolean("false")` is `true`. Only an
 * explicit affirmative counts, so a typo fails safe rather than silently
 * enabling ingestion.
 */
function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * Accepts base64 or hex so whichever form `openssl rand` produced can be pasted
 * in directly. Must decode to exactly 32 bytes — a shorter key would silently
 * weaken AES-256-GCM, so a wrong length is a configuration error, not something
 * to pad around.
 */
export function parseEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // fall through to null
  }
  return null;
}

export function readInboundConfig(): ConfigOutcome {
  const missing: string[] = [];

  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "");
  if (!domain) missing.push("INBOUND_EMAIL_DOMAIN");

  const providerApiKey = process.env.INBOUND_PROVIDER_API_KEY?.trim();
  if (!providerApiKey) missing.push("INBOUND_PROVIDER_API_KEY");

  const webhookSigningSecret = process.env.INBOUND_WEBHOOK_SIGNING_SECRET?.trim();
  if (!webhookSigningSecret) missing.push("INBOUND_WEBHOOK_SIGNING_SECRET");

  const tokenEncryptionKey = parseEncryptionKey(process.env.INBOUND_TOKEN_ENCRYPTION_KEY);
  if (!tokenEncryptionKey) missing.push("INBOUND_TOKEN_ENCRYPTION_KEY");

  const serviceEmail = process.env.INBOUND_SERVICE_EMAIL?.trim();
  if (!serviceEmail) missing.push("INBOUND_SERVICE_EMAIL");
  const servicePassword = process.env.INBOUND_SERVICE_PASSWORD;
  if (!servicePassword) missing.push("INBOUND_SERVICE_PASSWORD");

  const provider = (process.env.INBOUND_EMAIL_PROVIDER?.trim().toLowerCase() || "resend") as string;
  if (provider !== "resend") {
    return {
      ok: false,
      missing,
      detail: `unsupported INBOUND_EMAIL_PROVIDER "${provider}" (only "resend" has an adapter)`,
    };
  }

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      enabled: boolFromEnv("INBOUND_EMAIL_ENABLED", false),
      provider: "resend",
      domain: domain as string,
      providerApiKey: providerApiKey as string,
      webhookSigningSecret: webhookSigningSecret as string,
      toleranceSeconds: intFromEnv("INBOUND_WEBHOOK_TOLERANCE_SECONDS", 300),
      requireEmailAuth: boolFromEnv("INBOUND_REQUIRE_EMAIL_AUTH", false),
      limits: {
        maxAttachments: intFromEnv("INBOUND_MAX_ATTACHMENTS", DEFAULT_LIMITS.maxAttachments),
        maxFileBytes: intFromEnv("INBOUND_MAX_FILE_BYTES", DEFAULT_LIMITS.maxFileBytes),
        maxTotalBytes: intFromEnv("INBOUND_MAX_TOTAL_BYTES", DEFAULT_LIMITS.maxTotalBytes),
      },
      retentionDays: intFromEnv("INBOUND_RETENTION_DAYS", 30),
      tokenEncryptionKey: tokenEncryptionKey as Buffer,
      serviceEmail: serviceEmail as string,
      servicePassword: servicePassword as string,
    },
  };
}

/**
 * Alias-management routes need the domain and the encryption key, but not the
 * webhook secret or the provider key — an accountant can be shown their address
 * on a deployment where the webhook is not yet wired up. Kept separate so the
 * settings screen does not 503 on a half-finished provider setup.
 */
export type AliasConfigOutcome =
  | {
      ok: true;
      domain: string;
      tokenEncryptionKey: Buffer;
      enabled: boolean;
      /** Needed at enable time, to invite this account to the company. */
      serviceEmail: string;
      servicePassword: string;
    }
  | { ok: false; missing: string[] };

export function readAliasConfig(): AliasConfigOutcome {
  const missing: string[] = [];
  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "");
  if (!domain) missing.push("INBOUND_EMAIL_DOMAIN");
  const tokenEncryptionKey = parseEncryptionKey(process.env.INBOUND_TOKEN_ENCRYPTION_KEY);
  if (!tokenEncryptionKey) missing.push("INBOUND_TOKEN_ENCRYPTION_KEY");
  const serviceEmail = process.env.INBOUND_SERVICE_EMAIL?.trim();
  if (!serviceEmail) missing.push("INBOUND_SERVICE_EMAIL");
  const servicePassword = process.env.INBOUND_SERVICE_PASSWORD;
  if (!servicePassword) missing.push("INBOUND_SERVICE_PASSWORD");

  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    domain: domain as string,
    tokenEncryptionKey: tokenEncryptionKey as Buffer,
    enabled: boolFromEnv("INBOUND_EMAIL_ENABLED", false),
    serviceEmail: serviceEmail as string,
    servicePassword: servicePassword as string,
  };
}
