import { Migration } from '@mikro-orm/migrations'

export class Migration20260411000000_cpq_orders extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "cpq_order_configurations" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "order_id" uuid not null,
      "source_quote_id" uuid null,
      "customer_id" uuid not null,
      "cpq_status" text not null default 'draft',
      "currency_code" text not null default 'USD',
      "pricing_summary" jsonb null,
      "metadata" jsonb null,
      "activated_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_order_configurations_pkey" primary key ("id")
    );`)
    this.addSql(`create unique index if not exists "cpq_order_configurations_order_unique" on "cpq_order_configurations" ("organization_id", "tenant_id", "order_id");`)
    this.addSql(`create index if not exists "cpq_order_configurations_scope_idx" on "cpq_order_configurations" ("organization_id", "tenant_id");`)
    this.addSql(`create index if not exists "cpq_order_configurations_customer_idx" on "cpq_order_configurations" ("organization_id", "tenant_id", "customer_id");`)
    this.addSql(`create index if not exists "cpq_order_configurations_source_quote_idx" on "cpq_order_configurations" ("organization_id", "tenant_id", "source_quote_id");`)
    this.addSql(`create index if not exists "cpq_order_configurations_status_idx" on "cpq_order_configurations" ("organization_id", "tenant_id", "cpq_status");`)

    this.addSql(`create table if not exists "cpq_order_line_configurations" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "order_line_id" uuid not null,
      "order_configuration_id" uuid not null,
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
      "source_quote_line_id" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_order_line_configurations_pkey" primary key ("id")
    );`)
    this.addSql(`create unique index if not exists "cpq_olc_order_line_unique" on "cpq_order_line_configurations" ("organization_id", "tenant_id", "order_line_id");`)
    this.addSql(`create index if not exists "cpq_olc_order_config_idx" on "cpq_order_line_configurations" ("organization_id", "tenant_id", "order_configuration_id");`)
    this.addSql(`create index if not exists "cpq_olc_parent_line_idx" on "cpq_order_line_configurations" ("organization_id", "tenant_id", "parent_line_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_order_line_configurations" cascade;`)
    this.addSql(`drop table if exists "cpq_order_configurations" cascade;`)
  }
}
