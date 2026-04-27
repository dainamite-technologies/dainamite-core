import { Migration } from '@mikro-orm/migrations'

export class Migration20260410000000_cpq_drop_datacentres_inventory extends Migration {
  async up(): Promise<void> {
    this.addSql(`drop table if exists "cpq_inventory_items" cascade;`)
    this.addSql(`drop table if exists "cpq_data_centres" cascade;`)
  }

  async down(): Promise<void> {
    // cpq_data_centres
    this.addSql(`create table "cpq_data_centres" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "city" text null, "country" text null, "address" text null, "capabilities" jsonb null, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_data_centres_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_data_centres_scope_idx" on "cpq_data_centres" ("organization_id", "tenant_id");`)
    this.addSql(`alter table "cpq_data_centres" add constraint "cpq_data_centres_code_unique" unique ("organization_id", "tenant_id", "code");`)

    // cpq_inventory_items
    this.addSql(`create table "cpq_inventory_items" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "customer_id" uuid not null, "product_id" uuid not null, "parent_inventory_item_id" uuid null, "status" text not null default 'pending', "configuration" jsonb not null, "charges" jsonb null, "data_centre_id" uuid null, "currency_code" text not null default 'USD', "activated_at" timestamptz null, "terminated_at" timestamptz null, "source_quote_id" uuid null, "source_order_id" uuid null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_inventory_items_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_inventory_items_customer_idx" on "cpq_inventory_items" ("organization_id", "tenant_id", "customer_id");`)
    this.addSql(`create index "cpq_inventory_items_parent_idx" on "cpq_inventory_items" ("organization_id", "tenant_id", "parent_inventory_item_id");`)
    this.addSql(`create index "cpq_inventory_items_status_idx" on "cpq_inventory_items" ("customer_id", "status");`)
    this.addSql(`create index "cpq_inventory_items_config_gin_idx" on "cpq_inventory_items" using gin ("configuration");`)
  }
}
