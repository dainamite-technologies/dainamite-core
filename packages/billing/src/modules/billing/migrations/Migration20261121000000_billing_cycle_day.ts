import { Migration } from '@mikro-orm/migrations'

/**
 * Bill cycle day + every-N cycles (2026-11-16 operator polish spec, item 4).
 *
 * - `billing_accounts.bill_cycle_anchor` → `bill_cycle_day`, now nullable
 *   (daily cycles have no day). Billing reads it: Bill Runs re-pin every
 *   advance to this day.
 * - `billing_accounts.bill_cycle_interval` int (default 1): one cycle spans N
 *   units, so `quarterly` becomes `monthly` × 3 and "every 30 days" is
 *   `daily` × 30.
 *
 * Hand-written like the package's earlier migrations: `yarn mercato db
 * generate` only diffs `@app` modules. Columns mirror `data/entities.ts` 1:1.
 */
export class Migration20261121000000_billing_cycle_day extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "billing_accounts" rename column "bill_cycle_anchor" to "bill_cycle_day";`)
    this.addSql(`alter table "billing_accounts" alter column "bill_cycle_day" drop not null;`)
    this.addSql(
      `alter table "billing_accounts" add column if not exists "bill_cycle_interval" integer not null default 1;`,
    )
    // `quarterly` is no longer a unit — keep any such row billable as monthly × 3.
    this.addSql(
      `update "billing_accounts" set "bill_cycle" = 'monthly', "bill_cycle_interval" = 3 where "bill_cycle" = 'quarterly';`,
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `update "billing_accounts" set "bill_cycle" = 'quarterly' where "bill_cycle" = 'monthly' and "bill_cycle_interval" = 3;`,
    )
    this.addSql(`alter table "billing_accounts" drop column if exists "bill_cycle_interval";`)
    this.addSql(`update "billing_accounts" set "bill_cycle_day" = '1' where "bill_cycle_day" is null;`)
    this.addSql(`alter table "billing_accounts" alter column "bill_cycle_day" set not null;`)
    this.addSql(`alter table "billing_accounts" rename column "bill_cycle_day" to "bill_cycle_anchor";`)
  }
}
