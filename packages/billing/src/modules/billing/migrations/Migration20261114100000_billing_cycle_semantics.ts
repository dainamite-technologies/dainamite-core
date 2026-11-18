import { Migration } from '@mikro-orm/migrations'

/**
 * Billing cycle semantics (Spec A).
 *
 * - `billing_items.charge_timing` ('in_advance' | 'in_arrears', default
 *   'in_advance') and `billing_items.prorate` (default true) — recurring
 *   items are billed in advance and partial periods are prorated.
 * - `billing_run_outcomes.cycles` — per-bill-date breakdown of a run.
 * - Drops `billing_runs.catch_up`: every run now catches up on all due
 *   cycles, so the flag has no meaning. Per the billing improvements
 *   decision D14 all instances are reseeded; no data is migrated.
 *
 * Hand-written like the package's earlier migrations: `yarn mercato db
 * generate` only diffs `@app` modules. Columns mirror `data/entities.ts` 1:1.
 */
export class Migration20261114100000_billing_cycle_semantics extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table "billing_items" add column if not exists "charge_timing" text not null default 'in_advance';`,
    )
    this.addSql(
      `alter table "billing_items" add column if not exists "prorate" boolean not null default true;`,
    )
    this.addSql(`alter table "billing_run_outcomes" add column if not exists "cycles" jsonb null;`)
    this.addSql(`alter table "billing_runs" drop column if exists "catch_up";`)
  }

  async down(): Promise<void> {
    this.addSql(
      `alter table "billing_runs" add column if not exists "catch_up" boolean not null default false;`,
    )
    this.addSql(`alter table "billing_run_outcomes" drop column if exists "cycles";`)
    this.addSql(`alter table "billing_items" drop column if exists "prorate";`)
    this.addSql(`alter table "billing_items" drop column if exists "charge_timing";`)
  }
}
