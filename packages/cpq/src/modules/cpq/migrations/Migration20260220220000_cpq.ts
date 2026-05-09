import { Migration } from '@mikro-orm/migrations'

export class Migration20260220220000_cpq extends Migration {
  async up(): Promise<void> {
    // cpq_data_centres
    this.addSql(`create table "cpq_data_centres" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "city" text null, "country" text null, "address" text null, "capabilities" jsonb null, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_data_centres_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_data_centres_scope_idx" on "cpq_data_centres" ("organization_id", "tenant_id");`)
    this.addSql(`alter table "cpq_data_centres" add constraint "cpq_data_centres_code_unique" unique ("organization_id", "tenant_id", "code");`)

    // cpq_product_attributes
    this.addSql(`create table "cpq_product_attributes" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "code" text not null, "name" text not null, "attribute_type" text not null, "options" jsonb null, "constraints" jsonb null, "sort_order" int not null default 0, "is_required" boolean not null default true, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_product_attributes_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_product_attributes_scope_idx" on "cpq_product_attributes" ("organization_id", "tenant_id", "product_id");`)
    this.addSql(`alter table "cpq_product_attributes" add constraint "cpq_product_attributes_code_unique" unique ("organization_id", "tenant_id", "product_id", "code");`)

    // cpq_pricing_tables
    this.addSql(`create table "cpq_pricing_tables" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "description" text null, "product_id" uuid null, "dimensions" jsonb not null, "price_columns" jsonb not null, "pricing_model" text not null, "currency_code" text not null default 'USD', "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_pricing_tables_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_pricing_tables_scope_idx" on "cpq_pricing_tables" ("organization_id", "tenant_id");`)
    this.addSql(`alter table "cpq_pricing_tables" add constraint "cpq_pricing_tables_code_unique" unique ("organization_id", "tenant_id", "code");`)

    // cpq_pricing_table_entries
    this.addSql(`create table "cpq_pricing_table_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "pricing_table_id" uuid not null, "dimension_values" jsonb not null, "tier_number" int null, "range_from" numeric null, "range_to" numeric null, "prices" jsonb not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_pricing_table_entries_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_pricing_table_entries_scope_idx" on "cpq_pricing_table_entries" ("organization_id", "tenant_id", "pricing_table_id");`)
    this.addSql(`create index "cpq_pricing_table_entries_dim_gin_idx" on "cpq_pricing_table_entries" using gin ("dimension_values");`)

    // cpq_product_charges
    this.addSql(`create table "cpq_product_charges" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "code" text not null, "name" text not null, "charge_type" text not null, "pricing_method" text not null, "pricing_table_id" uuid null, "price_column_key" text null, "quantity_attribute_code" text null, "applicability_condition" jsonb null, "sort_order" int not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_product_charges_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_product_charges_scope_idx" on "cpq_product_charges" ("organization_id", "tenant_id", "product_id");`)
    this.addSql(`alter table "cpq_product_charges" add constraint "cpq_product_charges_code_unique" unique ("organization_id", "tenant_id", "product_id", "code");`)

    // cpq_inventory_items
    this.addSql(`create table "cpq_inventory_items" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "customer_id" uuid not null, "product_id" uuid not null, "parent_inventory_item_id" uuid null, "status" text not null default 'pending', "configuration" jsonb not null, "charges" jsonb null, "data_centre_id" uuid null, "currency_code" text not null default 'USD', "activated_at" timestamptz null, "terminated_at" timestamptz null, "source_quote_id" uuid null, "source_order_id" uuid null, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_inventory_items_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_inventory_items_customer_idx" on "cpq_inventory_items" ("organization_id", "tenant_id", "customer_id");`)
    this.addSql(`create index "cpq_inventory_items_parent_idx" on "cpq_inventory_items" ("organization_id", "tenant_id", "parent_inventory_item_id");`)
    this.addSql(`create index "cpq_inventory_items_status_idx" on "cpq_inventory_items" ("customer_id", "status");`)
    this.addSql(`create index "cpq_inventory_items_config_gin_idx" on "cpq_inventory_items" using gin ("configuration");`)

    // cpq_quote_configurations
    this.addSql(`create table "cpq_quote_configurations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_id" uuid not null, "customer_id" uuid not null, "quote_type" text not null, "selected_parent_inventory_item_id" uuid null, "primary_item_configuration" jsonb null, "child_item_configurations" jsonb null, "validation_result" jsonb null, "pricing_summary" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_quote_configurations_pkey" primary key ("id"));`)
    this.addSql(`alter table "cpq_quote_configurations" add constraint "cpq_quote_configurations_quote_unique" unique ("organization_id", "tenant_id", "quote_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_quote_configurations" cascade;`)
    this.addSql(`drop table if exists "cpq_inventory_items" cascade;`)
    this.addSql(`drop table if exists "cpq_product_charges" cascade;`)
    this.addSql(`drop table if exists "cpq_pricing_table_entries" cascade;`)
    this.addSql(`drop table if exists "cpq_pricing_tables" cascade;`)
    this.addSql(`drop table if exists "cpq_product_attributes" cascade;`)
    this.addSql(`drop table if exists "cpq_data_centres" cascade;`)
  }
}
