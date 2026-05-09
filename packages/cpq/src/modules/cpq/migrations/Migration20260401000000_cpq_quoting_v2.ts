import { Migration } from '@mikro-orm/migrations'

export class Migration20260401000000_cpq_quoting_v2 extends Migration {
  async up(): Promise<void> {
    // ─── New table: cpq_quote_line_configurations ──────────────────
    this.addSql(`create table "cpq_quote_line_configurations" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "quote_line_id" uuid not null,
      "quote_configuration_id" uuid not null,
      "offering_id" uuid null,
      "product_id" uuid null,
      "spec_id" uuid null,
      "action" text not null default 'add',
      "parent_line_id" uuid null,
      "start_date" date null,
      "term_months" int null,
      "end_date" date null,
      "configuration" jsonb not null default '{}',
      "quantity" int not null default 1,
      "charges" jsonb null,
      "nrc_total" numeric(18, 4) not null default 0,
      "mrc_total" numeric(18, 4) not null default 0,
      "usage_estimates" jsonb null,
      "usage_total_estimated" numeric(18, 4) null,
      "validation_errors" jsonb null,
      "is_configured" boolean not null default false,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_quote_line_configurations_pkey" primary key ("id")
    );`)

    this.addSql(`alter table "cpq_quote_line_configurations" add constraint "cpq_qlc_quote_line_unique" unique ("organization_id", "tenant_id", "quote_line_id");`)
    this.addSql(`create index "cpq_qlc_quote_config_idx" on "cpq_quote_line_configurations" ("organization_id", "tenant_id", "quote_configuration_id");`)
    this.addSql(`create index "cpq_qlc_parent_line_idx" on "cpq_quote_line_configurations" ("organization_id", "tenant_id", "parent_line_id");`)

    // ─── Alter cpq_quote_configurations: add v2 columns ───────────
    this.addSql(`alter table "cpq_quote_configurations" add column "cpq_status" text not null default 'new';`)
    this.addSql(`alter table "cpq_quote_configurations" add column "version" int not null default 1;`)
    this.addSql(`alter table "cpq_quote_configurations" add column "parent_quote_id" uuid null;`)
    this.addSql(`alter table "cpq_quote_configurations" add column "currency_code" text not null default 'USD';`)
    this.addSql(`alter table "cpq_quote_configurations" add column "quote_context" jsonb null;`)

    // ─── Backfill existing records ────────────────────────────────
    this.addSql(`update "cpq_quote_configurations" set "cpq_status" = 'ready' where "pricing_summary" is not null;`)

    // ─── Drop v1 columns from cpq_quote_configurations ────────────
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "quote_type";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "selected_parent_inventory_item_id";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "primary_item_configuration";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "child_item_configurations";`)
  }

  async down(): Promise<void> {
    // Re-add v1 columns
    this.addSql(`alter table "cpq_quote_configurations" add column "quote_type" text not null default 'new_primary';`)
    this.addSql(`alter table "cpq_quote_configurations" add column "selected_parent_inventory_item_id" uuid null;`)
    this.addSql(`alter table "cpq_quote_configurations" add column "primary_item_configuration" jsonb null;`)
    this.addSql(`alter table "cpq_quote_configurations" add column "child_item_configurations" jsonb null;`)

    // Drop v2 columns
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "cpq_status";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "version";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "parent_quote_id";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "currency_code";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column if exists "quote_context";`)

    // Drop new table
    this.addSql(`drop table if exists "cpq_quote_line_configurations" cascade;`)
  }
}
