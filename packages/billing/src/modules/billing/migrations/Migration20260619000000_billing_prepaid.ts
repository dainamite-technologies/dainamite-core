import { Migration } from '@mikro-orm/migrations'

/**
 * Prepaid balance billing schema (SPEC-002).
 *
 * Additive only — extends `billing_accounts` + `billing_run_outcomes` and
 * adds the four new prepaid tables. Postpaid accounts are unaffected
 * (`billing_mode` defaults to 'postpaid', `credit_limit` to 0).
 *
 * Hand-written to match `data/entities.ts` 1:1 (index/constraint names mirror
 * the decorator names so a later `yarn mercato db generate` diffs clean). The
 * statements here are pure `create table` / `alter table … add column` —
 * never destructive to existing billing data.
 */
export class Migration20260619000000_billing_prepaid extends Migration {
  async up(): Promise<void> {
    // ─── billing_accounts: billing_mode + credit_limit ───────
    this.addSql(
      `alter table "billing_accounts" add column "billing_mode" text not null default 'postpaid';`,
    )
    this.addSql(
      `alter table "billing_accounts" add column "credit_limit" numeric(18, 4) not null default 0;`,
    )

    // ─── billing_run_outcomes: statement_id (prepaid analogue) ─
    this.addSql(`alter table "billing_run_outcomes" add column "statement_id" uuid null;`)

    // ─── billing_account_balances ────────────────────────────
    this.addSql(`create table "billing_account_balances" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_account_id" uuid not null,
      "currency_code" text not null,
      "balance" numeric(18, 4) not null default 0,
      "low_balance_threshold" numeric(18, 4) null,
      "last_movement_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "billing_account_balances_pkey" primary key ("id")
    );`)
    this.addSql(`alter table "billing_account_balances" add constraint "billing_account_balances_account_unique" unique ("tenant_id", "bill_account_id");`)
    this.addSql(`create index "billing_account_balances_balance_idx" on "billing_account_balances" ("organization_id", "tenant_id", "balance");`)

    // ─── billing_account_transactions ────────────────────────
    this.addSql(`create table "billing_account_transactions" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_account_id" uuid not null,
      "type" text not null,
      "amount" numeric(18, 4) not null,
      "currency_code" text not null,
      "balance_after" numeric(18, 4) not null,
      "usage_id" uuid null,
      "billing_item_id" uuid null,
      "topup_id" uuid null,
      "statement_id" uuid null,
      "description" text not null,
      "source_ref" text null,
      "metadata" jsonb null,
      "user_id" uuid null,
      "created_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_account_transactions_pkey" primary key ("id")
    );`)
    this.addSql(`alter table "billing_account_transactions" add constraint "billing_account_transactions_source_ref_unique" unique ("tenant_id", "bill_account_id", "source_ref");`)
    this.addSql(`create index "billing_account_transactions_history_idx" on "billing_account_transactions" ("organization_id", "tenant_id", "bill_account_id", "created_at");`)
    this.addSql(`create index "billing_account_transactions_account_type_idx" on "billing_account_transactions" ("bill_account_id", "type", "created_at");`)

    // ─── billing_topups ──────────────────────────────────────
    this.addSql(`create table "billing_topups" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_account_id" uuid not null,
      "status" text not null,
      "amount" numeric(18, 4) not null,
      "currency_code" text not null,
      "provider_key" text not null,
      "payment_id" uuid not null,
      "gateway_transaction_id" uuid null,
      "transaction_id" uuid null,
      "receipt_invoice_id" uuid null,
      "source_ref" text null,
      "metadata" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_topups_pkey" primary key ("id")
    );`)
    this.addSql(`alter table "billing_topups" add constraint "billing_topups_payment_id_unique" unique ("tenant_id", "payment_id");`)
    this.addSql(`create index "billing_topups_account_history_idx" on "billing_topups" ("organization_id", "tenant_id", "bill_account_id", "created_at");`)
    this.addSql(`create index "billing_topups_status_idx" on "billing_topups" ("tenant_id", "status");`)

    // ─── billing_statements ──────────────────────────────────
    this.addSql(`create table "billing_statements" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_account_id" uuid not null,
      "bill_run_id" uuid null,
      "period_start" date not null,
      "period_end" date not null,
      "currency_code" text not null,
      "opening_balance" numeric(18, 4) not null,
      "total_topups" numeric(18, 4) not null,
      "total_usage" numeric(18, 4) not null,
      "total_recurring" numeric(18, 4) not null,
      "total_adjustments" numeric(18, 4) not null default 0,
      "closing_balance" numeric(18, 4) not null,
      "debit_breakdown" jsonb not null,
      "status" text not null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "billing_statements_pkey" primary key ("id")
    );`)
    this.addSql(`alter table "billing_statements" add constraint "billing_statements_period_unique" unique ("tenant_id", "bill_account_id", "period_start", "period_end");`)
    this.addSql(`create index "billing_statements_account_period_idx" on "billing_statements" ("organization_id", "tenant_id", "bill_account_id", "period_end");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "billing_statements" cascade;`)
    this.addSql(`drop table if exists "billing_topups" cascade;`)
    this.addSql(`drop table if exists "billing_account_transactions" cascade;`)
    this.addSql(`drop table if exists "billing_account_balances" cascade;`)
    this.addSql(`alter table "billing_run_outcomes" drop column if exists "statement_id";`)
    this.addSql(`alter table "billing_accounts" drop column if exists "credit_limit";`)
    this.addSql(`alter table "billing_accounts" drop column if exists "billing_mode";`)
  }
}
