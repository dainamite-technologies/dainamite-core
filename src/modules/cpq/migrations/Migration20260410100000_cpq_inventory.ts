import { Migration } from '@mikro-orm/migrations'

export class Migration20260410100000_cpq_inventory extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "cpq_inventory_subscriptions" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "customer_id" uuid not null,
      "code" text not null,
      "name" text not null,
      "description" text null,
      "status" text not null default 'pending',
      "billing_cycle" text not null default 'monthly',
      "currency_code" text not null default 'USD',
      "mrc_amount" numeric(18, 4) not null default 0,
      "nrc_amount" numeric(18, 4) not null default 0,
      "start_date" date null,
      "current_term_end" date null,
      "term_months" int null,
      "auto_renew" boolean not null default true,
      "activated_at" timestamptz null,
      "suspended_at" timestamptz null,
      "terminated_at" timestamptz null,
      "pricing_summary" jsonb null,
      "source_quote_id" uuid null,
      "source_order_id" uuid null,
      "metadata" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_inventory_subscriptions_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "cpq_inventory_subscriptions_scope_idx" on "cpq_inventory_subscriptions" ("organization_id", "tenant_id");`)
    this.addSql(`create unique index if not exists "cpq_inventory_subscriptions_code_unique" on "cpq_inventory_subscriptions" ("organization_id", "tenant_id", "code");`)
    this.addSql(`create index if not exists "cpq_inventory_subscriptions_customer_idx" on "cpq_inventory_subscriptions" ("organization_id", "tenant_id", "customer_id");`)
    this.addSql(`create index if not exists "cpq_inventory_subscriptions_status_idx" on "cpq_inventory_subscriptions" ("organization_id", "tenant_id", "status");`)
    this.addSql(`create index if not exists "cpq_inventory_subscriptions_source_quote_idx" on "cpq_inventory_subscriptions" ("organization_id", "tenant_id", "source_quote_id");`)

    this.addSql(`create table if not exists "cpq_inventory_subscription_items" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "subscription_id" uuid not null,
      "customer_id" uuid not null,
      "parent_item_id" uuid null,
      "product_id" uuid null,
      "offering_id" uuid null,
      "spec_id" uuid null,
      "name" text not null,
      "status" text not null default 'pending',
      "configuration" jsonb not null default '{}',
      "charges" jsonb null,
      "mrc_amount" numeric(18, 4) not null default 0,
      "nrc_amount" numeric(18, 4) not null default 0,
      "currency_code" text not null default 'USD',
      "quantity" int not null default 1,
      "capacity_total" numeric(18, 4) null,
      "capacity_used" numeric(18, 4) null,
      "capacity_unit" text null,
      "source_quote_line_id" uuid null,
      "metadata" jsonb null,
      "sort_order" int not null default 0,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_inventory_subscription_items_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "cpq_inventory_subscription_items_scope_idx" on "cpq_inventory_subscription_items" ("organization_id", "tenant_id", "subscription_id");`)
    this.addSql(`create index if not exists "cpq_inventory_subscription_items_customer_idx" on "cpq_inventory_subscription_items" ("organization_id", "tenant_id", "customer_id");`)
    this.addSql(`create index if not exists "cpq_inventory_subscription_items_parent_idx" on "cpq_inventory_subscription_items" ("organization_id", "tenant_id", "parent_item_id");`)
    this.addSql(`create index if not exists "cpq_inventory_subscription_items_status_idx" on "cpq_inventory_subscription_items" ("organization_id", "tenant_id", "status");`)

    this.addSql(`create table if not exists "cpq_inventory_assets" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "customer_id" uuid not null,
      "subscription_id" uuid null,
      "subscription_item_id" uuid null,
      "product_id" uuid null,
      "offering_id" uuid null,
      "spec_id" uuid null,
      "code" text not null,
      "name" text not null,
      "description" text null,
      "status" text not null default 'pending',
      "asset_type" text not null default 'one_time',
      "currency_code" text not null default 'USD',
      "purchase_price" numeric(18, 4) not null default 0,
      "quantity" int not null default 1,
      "purchase_date" date null,
      "delivery_date" date null,
      "configuration" jsonb not null default '{}',
      "charges" jsonb null,
      "source_quote_id" uuid null,
      "source_order_id" uuid null,
      "source_quote_line_id" uuid null,
      "metadata" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_inventory_assets_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "cpq_inventory_assets_scope_idx" on "cpq_inventory_assets" ("organization_id", "tenant_id");`)
    this.addSql(`create unique index if not exists "cpq_inventory_assets_code_unique" on "cpq_inventory_assets" ("organization_id", "tenant_id", "code");`)
    this.addSql(`create index if not exists "cpq_inventory_assets_customer_idx" on "cpq_inventory_assets" ("organization_id", "tenant_id", "customer_id");`)
    this.addSql(`create index if not exists "cpq_inventory_assets_status_idx" on "cpq_inventory_assets" ("organization_id", "tenant_id", "status");`)
    this.addSql(`create index if not exists "cpq_inventory_assets_subscription_idx" on "cpq_inventory_assets" ("organization_id", "tenant_id", "subscription_id");`)
    this.addSql(`create index if not exists "cpq_inventory_assets_item_idx" on "cpq_inventory_assets" ("organization_id", "tenant_id", "subscription_item_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_inventory_assets" cascade;`)
    this.addSql(`drop table if exists "cpq_inventory_subscription_items" cascade;`)
    this.addSql(`drop table if exists "cpq_inventory_subscriptions" cascade;`)
  }
}
