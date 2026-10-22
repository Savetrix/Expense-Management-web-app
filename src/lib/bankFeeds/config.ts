// SERVER-ONLY. Settings for bank feeds (Plaid), read once per call into one
// object, the same way lib/inboundEmail/config.ts does it: a route that cannot
// run reports the missing variable NAMES (never values) and answers 503.
import { parseEncryptionKey } from "@/lib/inboundEmail/config";

export const SAVETRIX_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.savetrix.com/api";

export type PlaidEnvironmentName = "sandbox" | "production";

export interface BankFeedsConfig {
  /** Kill switch. Off: every bank route answers 503 and webhooks are acknowledged and ignored. */
  enabled: boolean;
  plaidEnv: PlaidEnvironmentName;
  /** Empty until the Plaid keys are set: CSV import, decisions and suggestions still work. */
  plaidClientId: string;
  plaidSecret: string;
  /**
   * Public HTTPS URL Plaid calls for SYNC_UPDATES_AVAILABLE and item errors.
   * Null on localhost (Plaid cannot reach it); "Sync now" covers that case.
   */
  webhookUrl: string | null;
  /** AES-256-GCM key that seals Plaid access tokens at rest. 32 bytes, base64 or hex. */
  tokenEncryptionKey: Buffer;
  /** MongoDB connection string (its own Atlas cluster, not the backend's database). */
  mongoUri: string;
  mongoDbName: string;
  /**
   * Days of history Plaid pulls on the first connect (Plaid default 90, max 730,
   * fixed per bank login once connected). More history costs nothing extra at
   * Plaid but puts every old line into "To review", so 365 is the default.
   */
  historyDays: number;
}

export type BankConfigOutcome = { ok: true; config: BankFeedsConfig } | { ok: false; missing: string[] };

/** Only an explicit affirmative turns the feature on, so a typo fails safe. */
function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

function webhookUrlFromEnv(): string | null {
  const explicit = process.env.PLAID_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  // Plaid only calls public https URLs; a localhost site URL would make every
  // link token carry a webhook that can never fire.
  if (site && site.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(site)) {
    return `${site}/api/plaid/webhook`;
  }
  return null;
}

export function readBankConfig(): BankConfigOutcome {
  const missing: string[] = [];

  // Plaid keys are optional here: without them everything except connecting a
  // bank works (CSV import, decisions, suggestions); plaid.ts refuses Plaid calls.
  const plaidClientId = process.env.PLAID_CLIENT_ID?.trim() ?? "";
  const plaidSecret = process.env.PLAID_SECRET?.trim() ?? "";

  // Sandbox unless production is asked for by name: real bank data only ever
  // flows when someone has deliberately switched it on.
  const plaidEnv: PlaidEnvironmentName = process.env.PLAID_ENV?.trim().toLowerCase() === "production" ? "production" : "sandbox";

  const tokenEncryptionKey = parseEncryptionKey(process.env.BANK_TOKEN_ENCRYPTION_KEY);
  if (!tokenEncryptionKey) missing.push("BANK_TOKEN_ENCRYPTION_KEY");

  const store = readStoreConfig();
  if (!store) missing.push("BANK_MONGODB_URI");

  if (missing.length > 0 || !tokenEncryptionKey || !store) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    config: {
      enabled: boolFromEnv("BANK_FEEDS_ENABLED", false),
      plaidEnv,
      plaidClientId,
      plaidSecret,
      webhookUrl: webhookUrlFromEnv(),
      tokenEncryptionKey,
      mongoUri: store.uri,
      mongoDbName: store.dbName,
      historyDays: Math.min(730, Math.max(30, Number(process.env.BANK_HISTORY_DAYS) || 365)),
    },
  };
}

/** The database alone — enough for invoice insights, which need no Plaid. */
export function readStoreConfig(): { uri: string; dbName: string } | null {
  const uri = process.env.BANK_MONGODB_URI?.trim();
  if (!uri) return null;
  return { uri, dbName: process.env.BANK_MONGODB_DB?.trim() || "bank-transactions" };
}
