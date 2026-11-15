import { Migration } from '@mikro-orm/migrations'

/**
 * Payments (Spec C): billing-owned payment register, source-typed
 * allocations (payments now, credit memos in Spec D) and CSV import batches.
 *
 * Hand-written like the package's earlier migrations (`yarn mercato db
 * generate` only diffs `@app` modules). Partial unique indexes cannot be
 * expressed with decorators, so they live here only.
 */
export class Migration20261117000000_billing_payments extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "billing_payments" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "received_at" date not null,
      "amount" numeric(18, 4) not null,
      "currency_code" text not null,
      "reference" text null,
      "payer_name" text null,
      "payer_account" text null,
      "source" text not null,
      "import_id" uuid null,
      "bill_account_id" uuid null,
      "status" text not null,
      "unallocated_amount" numeric(18, 4) not null,
      "match_reason" text null,
      "source_ref" text not null,
      "external_ref" text null,
      "topup_id" uuid null,
      "metadata" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_payments_pkey" primary key ("id"),
      constraint "billing_payments_amount_positive" check ("amount" > 0),
      constraint "billing_payments_unallocated_range" check ("unallocated_amount" >= 0 and "unallocated_amount" <= "amount")
    );`)
    this.addSql(`create index if not exists "billing_payments_status_idx" on "billing_payments" ("tenant_id", "organization_id", "status");`)
    this.addSql(`create index if not exists "billing_payments_account_idx" on "billing_payments" ("bill_account_id", "status");`)
    this.addSql(`create index if not exists "billing_payments_import_idx" on "billing_payments" ("import_id");`)
    this.addSql(
      `create unique index if not exists "billing_payments_source_ref_uq" on "billing_payments" ("tenant_id", "organization_id", "source_ref") where "deleted_at" is null;`,
    )
    this.addSql(
      `create unique index if not exists "billing_payments_external_ref_uq" on "billing_payments" ("tenant_id", "organization_id", "external_ref") where "external_ref" is not null;`,
    )

    this.addSql(`create table if not exists "billing_allocations" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "source_type" text not null,
      "source_id" uuid not null,
      "invoice_id" uuid not null,
      "bill_account_id" uuid not null,
      "amount" numeric(18, 4) not null,
      "currency_code" text not null,
      "allocated_by" text not null,
      "user_id" uuid null,
      "deallocated_by_user_id" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_allocations_pkey" primary key ("id"),
      constraint "billing_allocations_amount_positive" check ("amount" > 0)
    );`)
    this.addSql(`create index if not exists "billing_allocations_source_idx" on "billing_allocations" ("source_type", "source_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "billing_allocations_invoice_idx" on "billing_allocations" ("invoice_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "billing_allocations_account_idx" on "billing_allocations" ("bill_account_id") where "deleted_at" is null;`)

    this.addSql(`create table if not exists "billing_payment_imports" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "file_name" text not null,
      "row_count" int not null,
      "counts" jsonb null,
      "errors" jsonb null,
      "user_id" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_payment_imports_pkey" primary key ("id")
    );`)
    this.addSql(
      `create index if not exists "billing_payment_imports_scope_idx" on "billing_payment_imports" ("tenant_id", "organization_id", "created_at");`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "billing_payment_imports";`)
    this.addSql(`drop table if exists "billing_allocations";`)
    this.addSql(`drop table if exists "billing_payments";`)
  }
}
