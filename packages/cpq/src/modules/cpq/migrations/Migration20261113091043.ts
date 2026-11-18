import { Migration } from '@mikro-orm/migrations';

export class Migration20261113091043 extends Migration {

  override name = 'Migration20261113091043';

  override up(): void | Promise<void> {
    this.addSql(`create table "cpq_quote_line_costs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_configuration_id" uuid not null, "quote_id" uuid not null, "quote_line_id" uuid not null, "cost_key" text not null, "charge_code" text null, "origin" text not null, "cost_element_id" uuid null, "carried_from_item_cost_id" uuid null, "carried_from_hash" text null, "name" text not null, "role" text not null, "cost_type" text not null, "source" text not null, "cost_model" text not null, "value_status" text not null, "value_origin" text null, "unit_amount" numeric(18, 4) null, "instance_amount" numeric(18, 4) null, "currency_code" text null, "fx_rate" numeric(18, 8) null, "fx_rate_date" date null, "index_snapshot" jsonb null, "sourcing_status" text not null default 'not_requested', "cost_request_id" uuid null, "request_seq" int null, "requested_at" timestamptz null, "requested_by_user_id" uuid null, "answered_at" timestamptz null, "answered_by_user_id" uuid null, "decline_reason" text null, "proposed_amount" numeric(18, 4) null, "supplier_id" uuid null, "supplier_name" text null, "supplier_quote_ref" text null, "valid_until" date null, "supplier_term_end" date null, "supplier_min_term_months" int null, "note" text null, "error_code" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cpq_quote_line_costs_line_idx" on "cpq_quote_line_costs" ("organization_id", "tenant_id", "quote_line_id");`);
    this.addSql(`create index "cpq_quote_line_costs_config_idx" on "cpq_quote_line_costs" ("organization_id", "tenant_id", "quote_configuration_id");`);

    this.addSql(`create table "cpq_quote_markup_overrides" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_configuration_id" uuid not null, "quote_id" uuid not null, "quote_line_id" uuid not null, "charge_code" text not null, "markup_rule" text not null, "markup_value" numeric(18, 4) not null, "note" text not null, "created_by_user_id" uuid null, "updated_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cpq_quote_markup_overrides_line_idx" on "cpq_quote_markup_overrides" ("organization_id", "tenant_id", "quote_line_id");`);
    this.addSql(`create index "cpq_quote_markup_overrides_config_idx" on "cpq_quote_markup_overrides" ("organization_id", "tenant_id", "quote_configuration_id");`);
    // Hand-added (MikroORM cannot express partial indexes / value sets):
    // the cost key is unique per line, and one markup override per charge, among non-deleted rows.
    this.addSql(`create unique index "cpq_quote_line_costs_key_unique" on "cpq_quote_line_costs" ("quote_line_id", "cost_key") where "deleted_at" is null;`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_origin_check" check ("origin" in ('catalog', 'manual'));`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_value_status_check" check ("value_status" in ('none', 'estimated', 'confirmed'));`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_value_origin_check" check ("value_origin" is null or "value_origin" in ('catalog', 'manual'));`);
    this.addSql(`create unique index "cpq_quote_markup_overrides_charge_unique" on "cpq_quote_markup_overrides" ("quote_line_id", "charge_code") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "cpq_quote_markup_overrides" cascade;`);
    this.addSql(`drop table if exists "cpq_quote_line_costs" cascade;`);
  }

}
