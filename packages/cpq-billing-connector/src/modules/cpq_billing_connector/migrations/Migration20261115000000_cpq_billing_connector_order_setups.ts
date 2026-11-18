import { Migration } from '@mikro-orm/migrations'

/**
 * The connector's first table: the billing setup of a CPQ order (spec
 * `2026-11-15-cpq-billing-connector-order-billing-setup`).
 *
 * Hand-written like the other `@dainamite/*` package migrations: `yarn
 * mercato db generate` only diffs `@app` modules. Columns and indexes mirror
 * `data/entities.ts` 1:1. Cross-package references (`cpq_order_id`,
 * `billing_account_id`, `applied_billing_account_id`) are plain FK strings —
 * no foreign-key constraints across packages.
 */
export class Migration20261115000000_cpq_billing_connector_order_setups extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "cpq_billing_connector_order_setups" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "cpq_order_id" uuid not null,
      "customer_id" text not null,
      "currency_code" text not null,
      "account_mode" text not null,
      "billing_account_id" text null,
      "account_overrides" jsonb not null default '{}',
      "default_bill_start_date" date null,
      "line_bill_starts" jsonb not null default '{}',
      "applied_at" timestamptz null,
      "applied_billing_account_id" text null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_billing_connector_order_setups_pkey" primary key ("id")
    );`)
    this.addSql(
      `create unique index if not exists "cpq_billing_connector_order_setups_order_unique" on "cpq_billing_connector_order_setups" ("organization_id", "tenant_id", "cpq_order_id") where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "cpq_billing_connector_order_setups_customer_idx" on "cpq_billing_connector_order_setups" ("organization_id", "tenant_id", "customer_id");`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_billing_connector_order_setups" cascade;`)
  }
}
