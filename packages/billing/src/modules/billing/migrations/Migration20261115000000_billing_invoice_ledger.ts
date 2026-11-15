import { Migration } from '@mikro-orm/migrations'

/**
 * Standalone invoice ledger (Spec 0).
 *
 * Billing stops writing core `sales_invoices`: invoices, memos and top-up
 * receipts move to `billing_invoices` / `billing_invoice_lines`, numbered by
 * `billing_document_sequences`; prepaid settings move from core `configs`
 * into per-organization `billing_settings`.
 *
 * No data migration (billing improvements decision D14 — instances are
 * reseeded). Billing rows already in `sales_invoices` are left untouched.
 *
 * Hand-written: the partial unique indexes can't be expressed in entity
 * decorators, and `yarn mercato db generate` only diffs `@app` modules.
 */
export class Migration20261115000000_billing_invoice_ledger extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "billing_invoices" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "bill_account_id" uuid not null,
      "document_type" text not null default 'invoice',
      "number" text not null,
      "series" text null,
      "status" text not null default 'draft',
      "test_run" boolean not null default false,
      "bill_run_id" uuid null,
      "bill_date" date null,
      "period_start" date null,
      "period_end" date null,
      "issue_date" date null,
      "due_date" date null,
      "currency_code" text not null,
      "subtotal_net" numeric(18, 4) not null default 0,
      "tax_total" numeric(18, 4) not null default 0,
      "total_gross" numeric(18, 4) not null default 0,
      "paid_total" numeric(18, 4) not null default 0,
      "credited_total" numeric(18, 4) not null default 0,
      "outstanding" numeric(18, 4) not null default 0,
      "corrects_invoice_id" uuid null,
      "correction_reason" text null,
      "buyer_snapshot" jsonb null,
      "seller_snapshot" jsonb null,
      "pdf_attachment_id" uuid null,
      "topup_id" uuid null,
      "posted_at" timestamptz null,
      "metadata" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_invoices_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "billing_invoices_status_idx" on "billing_invoices" ("tenant_id", "organization_id", "status");`)
    this.addSql(`create index if not exists "billing_invoices_account_idx" on "billing_invoices" ("bill_account_id", "status", "due_date");`)
    this.addSql(`create index if not exists "billing_invoices_run_idx" on "billing_invoices" ("bill_run_id");`)
    this.addSql(`create index if not exists "billing_invoices_corrects_idx" on "billing_invoices" ("corrects_invoice_id");`)
    this.addSql(`create index if not exists "billing_invoices_topup_idx" on "billing_invoices" ("topup_id");`)
    // Spec A dedupe backstop: one invoice per (account, bill date, test flag).
    this.addSql(`create unique index if not exists "billing_invoices_bill_date_uq" on "billing_invoices"
      ("tenant_id", "organization_id", "bill_account_id", "bill_date", "test_run")
      where "document_type" = 'invoice' and "deleted_at" is null and "bill_date" is not null;`)
    // A posted number is unique within the organization.
    this.addSql(`create unique index if not exists "billing_invoices_number_uq" on "billing_invoices"
      ("tenant_id", "organization_id", "number") where "series" is not null;`)

    this.addSql(`create table if not exists "billing_invoice_lines" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "invoice_id" uuid not null,
      "line_number" int not null,
      "billing_item_id" uuid null,
      "billing_type" text not null,
      "description" text not null,
      "quantity" numeric(18, 4) not null,
      "unit_price_net" numeric(18, 4) not null,
      "tax_rate" numeric(7, 4) not null default 0,
      "net_amount" numeric(18, 4) not null,
      "tax_amount" numeric(18, 4) not null default 0,
      "gross_amount" numeric(18, 4) not null,
      "service_period_start" date null,
      "service_period_end" date null,
      "corrects_line_id" uuid null,
      "metadata" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_invoice_lines_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "billing_invoice_lines_invoice_idx" on "billing_invoice_lines" ("invoice_id", "line_number");`)

    this.addSql(`create table if not exists "billing_document_sequences" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "series" text not null,
      "scope_key" text not null default '',
      "next_value" bigint not null default 1,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "billing_document_sequences_pkey" primary key ("id"),
      constraint "billing_document_sequences_scope_uq" unique ("tenant_id", "organization_id", "series", "scope_key")
    );`)

    this.addSql(`create table if not exists "billing_settings" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "low_balance_threshold_default" numeric(18, 4) not null default 0,
      "near_limit_buffer_default" numeric(18, 4) not null default 0,
      "statement_enabled" boolean not null default true,
      "topup_tax_rate" numeric(7, 4) not null default 0,
      "topup_provider" text not null default 'stripe',
      "number_masks" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_settings_pkey" primary key ("id")
    );`)
    this.addSql(`create unique index if not exists "billing_settings_org_uq" on "billing_settings"
      ("tenant_id", "organization_id") where "deleted_at" is null;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "billing_settings" cascade;`)
    this.addSql(`drop table if exists "billing_document_sequences" cascade;`)
    this.addSql(`drop table if exists "billing_invoice_lines" cascade;`)
    this.addSql(`drop table if exists "billing_invoices" cascade;`)
  }
}
