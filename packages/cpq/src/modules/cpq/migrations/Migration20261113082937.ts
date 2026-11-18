import { Migration } from '@mikro-orm/migrations';

export class Migration20261113082937 extends Migration {

  override name = 'Migration20261113082937';

  override up(): void | Promise<void> {
    this.addSql(`create table "cpq_charge_cost_elements" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_charge_id" uuid not null, "code" text not null, "name" text not null, "role" text not null, "cost_type" text not null, "source" text not null, "cost_model" text not null, "amount" numeric(18, 4) null, "currency_code" text null, "cost_table_id" uuid null, "cost_column_key" text null, "estimate_amount" numeric(18, 4) null, "default_supplier_id" uuid null, "default_supplier_name" text null, "default_validity_days" int null, "requires_sourcing" boolean not null default false, "applicability_condition" jsonb null, "sort_order" int not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cpq_charge_cost_elements_table_idx" on "cpq_charge_cost_elements" ("organization_id", "tenant_id", "cost_table_id");`);
    this.addSql(`create index "cpq_charge_cost_elements_scope_idx" on "cpq_charge_cost_elements" ("organization_id", "tenant_id", "product_charge_id");`);
    // Hand-added (MikroORM cannot express partial indexes / value sets):
    // the cost key is unique per charge among non-deleted elements.
    this.addSql(`create unique index "cpq_charge_cost_elements_code_unique" on "cpq_charge_cost_elements" ("product_charge_id", "code") where "deleted_at" is null;`);
    this.addSql(`alter table "cpq_charge_cost_elements" add constraint "cpq_charge_cost_elements_role_check" check ("role" in ('price_basis', 'margin_only'));`);
    this.addSql(`alter table "cpq_charge_cost_elements" add constraint "cpq_charge_cost_elements_cost_type_check" check ("cost_type" in ('nrc', 'mrc'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "cpq_charge_cost_elements" cascade;`);
  }

}
