import { Migration } from '@mikro-orm/migrations'

/**
 * Own billing period per line, line status and price phases
 * (2026-11-26 line-period-and-status spec Phases 1–2, price-phases spec Phase 1).
 *
 * - `billing_items.billing_period_unit` / `billing_period_interval`: the
 *   item's own period (null = follow the account cycle).
 * - `billing_items.phases_enabled`: the price-phases switch.
 * - `billing_item_phases`: back-to-back price phases per item.
 * - `billing_item_status_periods`: dated paused / suspended / grace periods,
 *   with the engine-owned `applied_from` / `applied_to` range.
 *
 * Hand-written like the package's earlier migrations: `yarn mercato db
 * generate` only diffs `@app` modules. Columns mirror `data/entities.ts`.
 */
export class Migration20261126000000_billing_item_period_status_phases extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table "billing_items" add column if not exists "billing_period_unit" text null, add column if not exists "billing_period_interval" int null, add column if not exists "phases_enabled" boolean not null default false;`,
    )
    this.addSql(`alter table "billing_items" drop constraint if exists "billing_items_billing_period_check";`)
    this.addSql(
      `alter table "billing_items" add constraint "billing_items_billing_period_check" check (("billing_period_unit" is null and "billing_period_interval" is null) or ("billing_period_unit" in ('daily', 'weekly', 'monthly', 'annually') and "billing_period_interval" >= 1));`,
    )

    this.addSql(`create table if not exists "billing_item_phases" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "billing_item_id" uuid not null,
      "sequence" int not null,
      "name" text null,
      "duration_unit" text null,
      "duration_count" int null,
      "end_date" date null,
      "price_type" text not null,
      "value" numeric(18, 4) null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_item_phases_pkey" primary key ("id"),
      constraint "billing_item_phases_price_type_check" check ("price_type" in ('free', 'fixed', 'percent_off', 'amount_off')),
      constraint "billing_item_phases_duration_check" check (("duration_unit" is not null and "duration_count" >= 1 and "end_date" is null) or ("duration_unit" is null and "duration_count" is null and "end_date" is not null))
    );`)
    this.addSql(`create index if not exists "billing_item_phases_item_idx" on "billing_item_phases" ("billing_item_id", "sequence") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "billing_item_phases_scope_idx" on "billing_item_phases" ("organization_id", "tenant_id");`)

    this.addSql(`create table if not exists "billing_item_status_periods" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "billing_item_id" uuid not null,
      "status" text not null,
      "from_date" date not null,
      "to_date" date null,
      "charge_behavior" text not null,
      "reason" text null,
      "applied_from" date null,
      "applied_to" date null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "billing_item_status_periods_pkey" primary key ("id"),
      constraint "billing_item_status_periods_status_check" check ("status" in ('paused', 'suspended', 'grace')),
      constraint "billing_item_status_periods_charge_check" check ("charge_behavior" in ('charge', 'no_charge')),
      constraint "billing_item_status_periods_range_check" check ("to_date" is null or "to_date" >= "from_date")
    );`)
    this.addSql(`create index if not exists "billing_item_status_periods_item_idx" on "billing_item_status_periods" ("billing_item_id", "from_date");`)
    this.addSql(`create index if not exists "billing_item_status_periods_scope_idx" on "billing_item_status_periods" ("organization_id", "tenant_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "billing_item_status_periods" cascade;`)
    this.addSql(`drop table if exists "billing_item_phases" cascade;`)
    this.addSql(`alter table "billing_items" drop constraint if exists "billing_items_billing_period_check";`)
    this.addSql(
      `alter table "billing_items" drop column if exists "billing_period_unit", drop column if exists "billing_period_interval", drop column if exists "phases_enabled";`,
    )
  }
}
