// SERVER-ONLY. The few Plaid calls bank feeds needs, behind one small interface
// so tests can replace Plaid entirely (setPlaidGatewayForTests).
//
// Access tokens never leave the server: they are sealed into the database by
// the exchange route and opened only here, for the length of one call.
import {
  Configuration,
  CountryCode,
  CreditAccountSubtype,
  DepositoryAccountSubtype,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type AccountsGetResponse,
  type InstitutionsGetByIdResponse,
  type ItemGetResponse,
  type ItemPublicTokenExchangeResponse,
  type LinkTokenCreateResponse,
  type SandboxPublicTokenCreateResponse,
  type TransactionsSyncResponse,
  type WebhookVerificationKeyGetResponse,
  type RemovedTransaction,
  type Transaction,
  WebhookType,
} from "plaid";

import type { BankFeedsConfig } from "./config";

/** A Plaid error, reduced to what callers act on. Never carries a token. */
export class PlaidCallError extends Error {
  constructor(
    readonly code: string,
    readonly type: string,
    message: string,
    readonly displayMessage: string | null,
    readonly httpStatus: number | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "PlaidCallError";
  }
  /** The bank login expired or changed: the user must reconnect through update mode. */
  get needsRelogin(): boolean {
    return this.code === "ITEM_LOGIN_REQUIRED" || this.code === "PENDING_DISCONNECT" || this.code === "PENDING_EXPIRATION" || this.code === "INVALID_UPDATED_USERNAME";
  }
  /** The item no longer exists at Plaid (removed or revoked elsewhere). */
  get itemGone(): boolean {
    return this.code === "ITEM_NOT_FOUND" || this.code === "INVALID_ACCESS_TOKEN";
  }
}

export interface SyncPage {
  added: Transaction[];
  modified: Transaction[];
  removed: RemovedTransaction[];
  accounts: AccountBase[];
  nextCursor: string;
  hasMore: boolean;
}

export interface PlaidGateway {
  createLinkToken(args: { clientUserId: string; webhook: string | null; accessToken?: string; daysRequested: number }): Promise<{ linkToken: string; expiration: string }>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  getAccounts(accessToken: string): Promise<{ institutionId: string | null; consentExpiresAt: string | null; accounts: AccountBase[] }>;
  syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage>;
  removeItem(accessToken: string): Promise<void>;
  /** Health check without a webhook: Plaid's own view of the item's error, if any. */
  itemError(accessToken: string): Promise<string | null>;
  institutionName(institutionId: string): Promise<string | null>;
  webhookKey(keyId: string): Promise<Record<string, unknown> | null>;
  /** Sandbox only: an item without going through Link. */
  sandboxPublicToken(institutionId: string, overrideUsername?: string): Promise<string>;
  sandboxFireWebhook(accessToken: string, code: "SYNC_UPDATES_AVAILABLE" | "NEW_ACCOUNTS_AVAILABLE" | "ERROR" | "USER_PERMISSION_REVOKED" | "PENDING_DISCONNECT"): Promise<void>;
  sandboxResetLogin(accessToken: string): Promise<void>;
}

function toCallError(error: unknown): PlaidCallError {
  const e = error as { response?: { status?: number; data?: Record<string, unknown> }; message?: string };
  const data = e?.response?.data ?? {};
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  return new PlaidCallError(
    str("error_code") ?? "PLAID_UNREACHABLE",
    str("error_type") ?? "API_ERROR",
    str("error_message") ?? "Plaid could not be reached",
    str("display_message"),
    e?.response?.status ?? null,
    str("request_id"),
  );
}

// The SDK's .d.ts targets a newer axios than the one installed, so response
// types do not infer; each call names its response type instead.
async function call<T>(fn: () => Promise<unknown>): Promise<T> {
  try {
    return ((await fn()) as { data: T }).data;
  } catch (error) {
    throw toCallError(error);
  }
}

class SdkGateway implements PlaidGateway {
  private readonly api: PlaidApi;
  constructor(private readonly config: BankFeedsConfig) {
    this.api = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[config.plaidEnv],
        baseOptions: {
          headers: { "PLAID-CLIENT-ID": config.plaidClientId, "PLAID-SECRET": config.plaidSecret },
          timeout: 20_000,
        },
      }),
    );
  }

  async createLinkToken({ clientUserId, webhook, accessToken, daysRequested }: { clientUserId: string; webhook: string | null; accessToken?: string; daysRequested: number }) {
    const data = await call<LinkTokenCreateResponse>(() =>
      this.api.linkTokenCreate({
        client_name: "ScanTrix",
        language: "en",
        country_codes: [CountryCode.Us, CountryCode.Ca],
        user: { client_user_id: clientUserId },
        ...(webhook ? { webhook } : {}),
        // Update mode (an expired login) passes the item's access token and no products.
        ...(accessToken
          ? { access_token: accessToken, update: { account_selection_enabled: true } }
          : {
              products: [Products.Transactions],
              transactions: { days_requested: daysRequested },
              // Business bookkeeping: bank accounts and credit cards, not loans or investments.
              account_filters: {
                depository: { account_subtypes: [DepositoryAccountSubtype.Checking, DepositoryAccountSubtype.Savings] },
                credit: { account_subtypes: [CreditAccountSubtype.CreditCard] },
              },
            }),
      }),
    );
    return { linkToken: data.link_token, expiration: data.expiration };
  }

  async exchangePublicToken(publicToken: string) {
    const data = await call<ItemPublicTokenExchangeResponse>(() => this.api.itemPublicTokenExchange({ public_token: publicToken }));
    return { accessToken: data.access_token, itemId: data.item_id };
  }

  async getAccounts(accessToken: string) {
    const data = await call<AccountsGetResponse>(() => this.api.accountsGet({ access_token: accessToken }));
    return {
      institutionId: data.item.institution_id ?? null,
      consentExpiresAt: data.item.consent_expiration_time ?? null,
      accounts: data.accounts,
    };
  }

  async syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage> {
    const data = await call<TransactionsSyncResponse>(() =>
      this.api.transactionsSync({
        access_token: accessToken,
        ...(cursor ? { cursor } : {}),
        count: 500,
        // The bank's own wording ("UBER *TRIP HELP.UBER.COM") is what the user
        // recognises; Plaid's cleaned-up `merchant_name` feeds the vendor guess.
        options: { include_personal_finance_category: true, include_original_description: true },
      }),
    );
    return {
      added: data.added,
      modified: data.modified,
      removed: data.removed,
      accounts: data.accounts ?? [],
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
    };
  }

  async removeItem(accessToken: string) {
    await call(() => this.api.itemRemove({ access_token: accessToken }));
  }

  async itemError(accessToken: string) {
    const data = await call<ItemGetResponse>(() => this.api.itemGet({ access_token: accessToken }));
    return data.item.error?.error_code ?? null;
  }

  async institutionName(institutionId: string) {
    try {
      const data = await call<InstitutionsGetByIdResponse>(() =>
        this.api.institutionsGetById({ institution_id: institutionId, country_codes: [CountryCode.Us, CountryCode.Ca] }),
      );
      return data.institution.name ?? null;
    } catch {
      return null;
    }
  }

  async webhookKey(keyId: string) {
    const data = await call<WebhookVerificationKeyGetResponse>(() => this.api.webhookVerificationKeyGet({ key_id: keyId }));
    return (data.key as unknown as Record<string, unknown>) ?? null;
  }

  async sandboxPublicToken(institutionId: string, overrideUsername?: string) {
    this.assertSandbox();
    const data = await call<SandboxPublicTokenCreateResponse>(() =>
      this.api.sandboxPublicTokenCreate({
        institution_id: institutionId,
        initial_products: [Products.Transactions],
        options: overrideUsername ? { override_username: overrideUsername, override_password: "pass_good" } : undefined,
      }),
    );
    return data.public_token;
  }

  async sandboxFireWebhook(accessToken: string, code: Parameters<PlaidGateway["sandboxFireWebhook"]>[1]) {
    this.assertSandbox();
    await call(() =>
      this.api.sandboxItemFireWebhook({
        access_token: accessToken,
        webhook_code: code as never,
        ...(code === "SYNC_UPDATES_AVAILABLE" ? { webhook_type: WebhookType.Transactions } : {}),
      }),
    );
  }

  async sandboxResetLogin(accessToken: string) {
    this.assertSandbox();
    await call(() => this.api.sandboxItemResetLogin({ access_token: accessToken }));
  }

  private assertSandbox() {
    if (this.config.plaidEnv !== "sandbox") throw new PlaidCallError("SANDBOX_ONLY", "INVALID_REQUEST", "sandbox-only call refused outside sandbox", null, null, null);
  }
}

let override: PlaidGateway | null = null;
const g = globalThis as { __plaidGateways?: Map<string, PlaidGateway> };

export function plaidGateway(config: BankFeedsConfig): PlaidGateway {
  if (override) return override;
  g.__plaidGateways ??= new Map();
  const key = `${config.plaidEnv}:${config.plaidClientId}`;
  let gateway = g.__plaidGateways.get(key);
  if (!gateway) {
    gateway = new SdkGateway(config);
    g.__plaidGateways.set(key, gateway);
  }
  return gateway;
}

/** Tests only. */
export function setPlaidGatewayForTests(gateway: PlaidGateway | null): void {
  override = gateway;
}
