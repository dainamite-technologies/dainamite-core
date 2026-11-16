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
 * Existing rows are re-pinned to the day their `next_bill_date` falls on, so
 * no account's schedule changes and legacy anchors cannot fail validation.
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
    // The old anchor was never read, so it can disagree with the schedule that
    // actually runs (e.g. connector accounts: anchor '1', next bill on the 14th)
    // or have a shape that is invalid for its cycle ('Mon', '15' on weekly).
    // Pin every row to the day its `next_bill_date` falls on: no account's bill
    // dates move, and every row passes the new cross-field validation.
    this.addSql(
      `update "billing_accounts" set "bill_cycle_day" = (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from "next_bill_date")::int + 1] where "bill_cycle" = 'weekly';`,
    )
    this.addSql(
      `update "billing_accounts" set "bill_cycle_day" = extract(day from "next_bill_date")::int::text where "bill_cycle" in ('monthly', 'annually');`,
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
