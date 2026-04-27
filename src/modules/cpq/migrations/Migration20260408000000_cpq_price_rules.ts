import { Migration } from '@mikro-orm/migrations'

export class Migration20260408000000_cpq_price_rules extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "cpq_price_rules" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "code" text not null,
      "name" text not null,
      "description" text null,
      "product_offering_id" uuid null,
      "rule_type" text not null,
      "value" numeric not null,
      "charge_code_filter" text null,
      "charge_type_filter" text null,
      "applicability_condition" jsonb null,
      "sort_order" int not null default 0,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_price_rules_pkey" primary key ("id")
    );`)
    this.addSql(`create index if not exists "cpq_price_rules_scope_idx" on "cpq_price_rules" ("organization_id", "tenant_id");`)
    this.addSql(`create unique index if not exists "cpq_price_rules_code_unique" on "cpq_price_rules" ("organization_id", "tenant_id", "code");`)
    this.addSql(`create index if not exists "cpq_price_rules_product_idx" on "cpq_price_rules" ("organization_id", "tenant_id", "product_offering_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_price_rules" cascade;`)
  }
}
