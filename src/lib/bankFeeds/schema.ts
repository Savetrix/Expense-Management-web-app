// Bank-feeds tables. Append a new migration to change the schema; never edit
// one that has shipped (db.ts records each version once it is applied).
//
// Everything is scoped by `qb_connection_id`: bank data belongs to a company
// (one connection in QuickBooks or Xero), not to the person who connected it,
// so every team member with access to that company sees the same feed.
//
// Money is integer cents, negative = money out. Plaid reports money out as a
// POSITIVE amount, so sync inverts it once, on the way in (plaidMap.ts).

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE bank_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qb_connection_id text NOT NULL,
  plaid_item_id text NOT NULL UNIQUE,
  plaid_env text NOT NULL,
  institution_id text,
  institution_name text NOT NULL DEFAULT 'Bank',
  sealed_access_token text NOT NULL,
  sync_cursor text,
  -- active | login_required | pending_expiration | pending_disconnect | revoked | error
  status text NOT NULL DEFAULT 'active',
  error_code text,
  consent_expires_at timestamptz,
  initial_update_complete boolean NOT NULL DEFAULT false,
  historical_update_complete boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  last_sync_error text,
  -- One sync at a time per item; a webhook that lands mid-sync sets sync_requested_at.
  sync_lease_until timestamptz,
  sync_requested_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX bank_items_connection ON bank_items (qb_connection_id) WHERE removed_at IS NULL;

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES bank_items(id),
  qb_connection_id text NOT NULL,
  plaid_account_id text NOT NULL UNIQUE,
  name text NOT NULL,
  official_name text,
  mask text,
  type text,
  subtype text,
  currency text,
  current_balance_cents bigint,
  available_balance_cents bigint,
  balance_updated_at timestamptz,
  -- The bank or credit-card account in QuickBooks/Xero that this account posts to.
  ledger_account_id text,
  ledger_account_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX bank_accounts_connection ON bank_accounts (qb_connection_id) WHERE removed_at IS NULL;
CREATE INDEX bank_accounts_item ON bank_accounts (item_id);

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qb_connection_id text NOT NULL,
  account_id uuid REFERENCES bank_accounts(id),
  -- Shown in the list. A CSV row has only this, no account_id.
  account_label text NOT NULL,
  source text NOT NULL CHECK (source IN ('plaid', 'csv')),
  plaid_transaction_id text UNIQUE,
  csv_dedupe_key text,
  date date NOT NULL,
  authorized_date date,
  description text NOT NULL DEFAULT '',
  merchant_name text,
  merchant_entity_id text,
  counterparty_name text,
  counterparty_type text,
  logo_url text,
  website text,
  amount_cents bigint NOT NULL,
  currency text,
  category_primary text,
  category_detailed text,
  category_confidence text,
  payment_channel text,
  check_number text,

  -- The user's decision. Plaid updates never touch these columns.
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'matched', 'excluded', 'transfer')),
  matched_invoice_id text,
  transfer_account_id uuid REFERENCES bank_accounts(id),
  transfer_label text,
  gl_account_id text,
  tax_code_id text,
  vendor_id text,
  payee text,
  decided_by text,
  decided_at timestamptz,

  -- What Scantrix suggested, and why (suggest.ts).
  suggestion jsonb,
  -- Posting to QuickBooks/Xero: null | processing | posted | failed.
  posting_status text,
  posting jsonb,

  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Plaid removed the transaction; kept for the audit trail, hidden from lists.
  removed_at timestamptz
);
CREATE UNIQUE INDEX bank_transactions_csv_key ON bank_transactions (qb_connection_id, csv_dedupe_key) WHERE csv_dedupe_key IS NOT NULL;
CREATE INDEX bank_transactions_list ON bank_transactions (qb_connection_id, status, date DESC) WHERE removed_at IS NULL;
CREATE INDEX bank_transactions_invoice ON bank_transactions (qb_connection_id, matched_invoice_id) WHERE matched_invoice_id IS NOT NULL;
CREATE INDEX bank_transactions_account ON bank_transactions (account_id);

-- Who did what, for the audit trail and for learning from the user's choices.
CREATE TABLE bank_events (
  id bigserial PRIMARY KEY,
  qb_connection_id text NOT NULL,
  transaction_id uuid,
  item_id uuid,
  -- A user id, or "plaid" / "autopilot" / "system".
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_events_connection ON bank_events (qb_connection_id, at DESC);
CREATE INDEX bank_events_transaction ON bank_events (transaction_id);

CREATE TABLE bank_webhook_log (
  id bigserial PRIMARY KEY,
  plaid_item_id text,
  webhook_type text,
  webhook_code text,
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    version: 2,
    sql: `
-- Who a line was paid to, normalised (suggest.ts payeeKey). Past decisions on
-- lines with the same key are what Scantrix learns from.
ALTER TABLE bank_transactions ADD COLUMN payee_key text;
CREATE INDEX bank_transactions_payee ON bank_transactions (qb_connection_id, payee_key) WHERE removed_at IS NULL;
`,
  },
  {
    version: 3,
    sql: `
-- What Scantrix noticed on an invoice: the period it covers (period.ts), and
-- whether the user said "Not a prepayment". Keyed by the backend's invoice id.
CREATE TABLE invoice_insights (
  qb_connection_id text NOT NULL,
  invoice_id text NOT NULL,
  period_start date,
  period_end date,
  period_months numeric(5, 1),
  period_source text,
  period_evidence text,
  -- The invoice's updatedAt when the period was read; a later edit re-reads it.
  read_from text,
  prepayment_dismissed_at timestamptz,
  prepayment_dismissed_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (qb_connection_id, invoice_id)
);
`,
  },
];
