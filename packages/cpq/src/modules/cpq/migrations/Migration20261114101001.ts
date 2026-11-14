import { Migration } from '@mikro-orm/migrations';

export class Migration20261114101001 extends Migration {

  override name = 'Migration20261114101001';

  override up(): void | Promise<void> {
    this.addSql(`create table "cpq_inventory_costs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subscription_id" uuid not null, "subscription_item_id" uuid null, "asset_id" uuid null, "status" text not null default 'active', "started_at" date not null, "ended_at" date null, "last_change_id" uuid null, "last_order_line_cost_id" uuid null, "cost_key" text not null, "charge_code" text null, "origin" text not null, "cost_element_id" uuid null, "name" text not null, "role" text not null, "cost_type" text not null, "source" text not null, "cost_model" text not null, "value_status" text not null, "value_origin" text null, "unit_amount" numeric(18, 4) null, "instance_amount" numeric(18, 4) null, "total_amount" numeric(18, 4) null, "currency_code" text null, "fx_rate" numeric(18, 8) null, "fx_rate_date" date null, "index_snapshot" jsonb null, "supplier_id" uuid null, "supplier_name" text null, "supplier_quote_ref" text null, "valid_until" date null, "supplier_term_end" date null, "supplier_min_term_months" int null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cpq_inventory_costs_status_idx" on "cpq_inventory_costs" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "cpq_inventory_costs_asset_idx" on "cpq_inventory_costs" ("organization_id", "tenant_id", "asset_id");`);
    this.addSql(`create index "cpq_inventory_costs_item_idx" on "cpq_inventory_costs" ("organization_id", "tenant_id", "subscription_item_id");`);
    this.addSql(`create index "cpq_inventory_costs_subscription_idx" on "cpq_inventory_costs" ("organization_id", "tenant_id", "subscription_id");`);

    this.addSql(`create table "cpq_order_line_costs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_configuration_id" uuid not null, "order_line_id" uuid not null, "source_quote_line_cost_id" uuid not null, "inventory_cost_id" uuid null, "cost_key" text not null, "charge_code" text null, "origin" text not null, "cost_element_id" uuid null, "name" text not null, "role" text not null, "cost_type" text not null, "source" text not null, "cost_model" text not null, "value_status" text not null, "value_origin" text null, "unit_amount" numeric(18, 4) null, "instance_amount" numeric(18, 4) null, "total_amount" numeric(18, 4) null, "currency_code" text null, "fx_rate" numeric(18, 8) null, "fx_rate_date" date null, "index_snapshot" jsonb null, "supplier_id" uuid null, "supplier_name" text null, "supplier_quote_ref" text null, "valid_until" date null, "supplier_term_end" date null, "supplier_min_term_months" int null, "note" text null, "reconfirmed_at" timestamptz null, "reconfirmed_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cpq_order_line_costs_inventory_cost_idx" on "cpq_order_line_costs" ("organization_id", "tenant_id", "inventory_cost_id");`);
    this.addSql(`create index "cpq_order_line_costs_line_idx" on "cpq_order_line_costs" ("organization_id", "tenant_id", "order_line_id");`);
    this.addSql(`create index "cpq_order_line_costs_config_idx" on "cpq_order_line_costs" ("organization_id", "tenant_id", "order_configuration_id");`);
    // Hand-added (MikroORM cannot express partial indexes / checks):
    // one order line cost per (order line, cost key), and one inventory cost per (owner, cost key)
    // among non-deleted rows (I-10: a returning key reactivates its row); exactly one owner per
    // inventory cost (subscription item xor asset, Q2); the inventory cost status value set.
    this.addSql(`create unique index "cpq_order_line_costs_key_unique" on "cpq_order_line_costs" ("order_line_id", "cost_key") where "deleted_at" is null;`);
    this.addSql(`create unique index "cpq_inventory_costs_item_key_unique" on "cpq_inventory_costs" ("subscription_item_id", "cost_key") where "deleted_at" is null and "subscription_item_id" is not null;`);
    this.addSql(`create unique index "cpq_inventory_costs_asset_key_unique" on "cpq_inventory_costs" ("asset_id", "cost_key") where "deleted_at" is null and "asset_id" is not null;`);
    this.addSql(`alter table "cpq_inventory_costs" add constraint "cpq_inventory_costs_owner_check" check (num_nonnulls("subscription_item_id", "asset_id") = 1);`);
    this.addSql(`alter table "cpq_inventory_costs" add constraint "cpq_inventory_costs_status_check" check ("status" in ('active', 'ended'));`);
  }

  override down(): void | Promise<void> {
    // Hand-added: the generator emits no down for new tables (dropTables: false).
    this.addSql(`drop table if exists "cpq_order_line_costs" cascade;`);
    this.addSql(`drop table if exists "cpq_inventory_costs" cascade;`);
  }

}
