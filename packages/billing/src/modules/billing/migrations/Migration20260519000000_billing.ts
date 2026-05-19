import { Migration } from '@mikro-orm/migrations'

/**
 * Initial Billing module schema (XD-249 Phase 0).
 *
 * Hand-written rather than generated because the standalone-app build of
 * `@open-mercato/cli@0.6.0` does not yet auto-discover entities from
 * `@dainamite/*` workspaces — the resolver hard-codes `@open-mercato/*`
 * scope and looks for `data/entities.ts` against the dist symlink (which
 * only contains `entities.js`). The shipped migration here matches the
 * entity definitions in `packages/billing/src/modules/billing/data/entities.ts`
 * 1:1; if entities change in later phases, regenerate via MikroORM
 * directly or hand-update both sides in the same commit.
 */
export class Migration20260519000000_billing extends Migration {
  async up(): Promise<void> {
    // ─── billing_accounts ────────────────────────────────────
    this.addSql(`create table "billing_accounts" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "customer_id" text not null,
      "name" text not null,
      "currency_code" text not null,
      "bill_cycle" text not null,
      "bill_cycle_anchor" text not null,
      "invoice_email" text not null,
      "invoice_language" text not null,
      "tax_id" text null,
      "invoice_address" jsonb not null,
      "next_bill_date" date not null,
      "last_bill_date" date null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_accounts_pkey" primary key ("id")
    );`)
    this.addSql(`create index "billing_accounts_next_bill_date_idx" on "billing_accounts" ("tenant_id", "next_bill_date") where "deleted_at" is null;`)
    this.addSql(`create index "billing_accounts_customer_idx" on "billing_accounts" ("organization_id", "tenant_id", "customer_id");`)
    this.addSql(`create index "billing_accounts_sort_idx" on "billing_accounts" ("organization_id", "tenant_id", "deleted_at", "created_at");`)

    // ─── billing_items ───────────────────────────────────────
    this.addSql(`create table "billing_items" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_account_id" uuid not null,
      "type" text not null,
      "bill_start_date" date not null,
      "bill_end_date" date null,
      "description" text not null,
      "rate_json" jsonb not null,
      "uom_code" text null,
      "subscription_id" text null,
      "subscription_item_id" text null,
      "source_ref" text null,
      "currency_mismatch" boolean not null default false,
      "billed_to_date" date null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_items_pkey" primary key ("id")
    );`)
    this.addSql(`alter table "billing_items" add constraint "billing_items_source_ref_unique" unique ("tenant_id", "bill_account_id", "source_ref");`)
    this.addSql(`create index "billing_items_account_type_idx" on "billing_items" ("bill_account_id", "type");`)
    this.addSql(`create index "billing_items_account_active_idx" on "billing_items" ("bill_account_id", "type", "is_active") where "deleted_at" is null;`)
    this.addSql(`create index "billing_items_subscription_idx" on "billing_items" ("organization_id", "tenant_id", "subscription_id");`)

    // ─── billing_account_usage ───────────────────────────────
    this.addSql(`create table "billing_account_usage" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_account_id" uuid not null,
      "uom_code" text not null,
      "quantity" numeric(18, 4) not null,
      "period_start" timestamptz not null,
      "period_end" timestamptz not null,
      "line_description" text null,
      "source_ref" text null,
      "rated_in_bill_run_id" uuid null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_account_usage_pkey" primary key ("id")
    );`)
    this.addSql(`alter table "billing_account_usage" add constraint "billing_account_usage_source_ref_unique" unique ("tenant_id", "bill_account_id", "source_ref");`)
    this.addSql(`create index "billing_account_usage_rating_idx" on "billing_account_usage" ("bill_account_id", "uom_code", "rated_in_bill_run_id", "period_end");`)

    // ─── billing_runs ────────────────────────────────────────
    this.addSql(`create table "billing_runs" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "triggered_by" text not null,
      "parent_run_id" uuid null,
      "dry_run" boolean not null default false,
      "test_mode" boolean not null default false,
      "catch_up" boolean not null default false,
      "scoped_account_ids" jsonb null,
      "as_of_date" date not null,
      "started_at" timestamptz null,
      "finished_at" timestamptz null,
      "status" text not null,
      "summary" jsonb null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_runs_pkey" primary key ("id")
    );`)
    this.addSql(`create index "billing_runs_tenant_status_idx" on "billing_runs" ("tenant_id", "status", "started_at");`)
    this.addSql(`create index "billing_runs_parent_idx" on "billing_runs" ("parent_run_id");`)

    // ─── billing_run_outcomes ────────────────────────────────
    this.addSql(`create table "billing_run_outcomes" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_run_id" uuid not null,
      "bill_account_id" uuid not null,
      "status" text not null,
      "error_message" text null,
      "warnings" jsonb null,
      "draft_invoice_id" uuid null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_run_outcomes_pkey" primary key ("id")
    );`)
    this.addSql(`create index "billing_run_outcomes_run_status_idx" on "billing_run_outcomes" ("bill_run_id", "status");`)
    this.addSql(`create index "billing_run_outcomes_account_history_idx" on "billing_run_outcomes" ("organization_id", "tenant_id", "bill_account_id", "created_at");`)

    // ─── billing_draft_invoice_edits ─────────────────────────
    this.addSql(`create table "billing_draft_invoice_edits" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "invoice_id" uuid not null,
      "invoice_line_id" uuid null,
      "user_id" uuid not null,
      "action" text not null,
      "before_json" jsonb null,
      "after_json" jsonb null,
      "created_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_draft_invoice_edits_pkey" primary key ("id")
    );`)
    this.addSql(`create index "billing_draft_invoice_edits_invoice_idx" on "billing_draft_invoice_edits" ("organization_id", "tenant_id", "invoice_id", "created_at");`)
    this.addSql(`create index "billing_draft_invoice_edits_user_idx" on "billing_draft_invoice_edits" ("organization_id", "tenant_id", "user_id", "created_at");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "billing_draft_invoice_edits" cascade;`)
    this.addSql(`drop table if exists "billing_run_outcomes" cascade;`)
    this.addSql(`drop table if exists "billing_runs" cascade;`)
    this.addSql(`drop table if exists "billing_account_usage" cascade;`)
    this.addSql(`drop table if exists "billing_items" cascade;`)
    this.addSql(`drop table if exists "billing_accounts" cascade;`)
  }
}
