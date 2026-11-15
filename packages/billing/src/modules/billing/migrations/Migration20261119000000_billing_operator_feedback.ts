import { Migration } from '@mikro-orm/migrations'

/**
 * Operator feedback round 1 (Spec F).
 *
 * - `billing_items.price_basis` ('net' | 'gross', default 'net'): the item
 *   price is stored as typed; invoice lines and prepaid debits are computed
 *   from that basis (F-D2).
 * - `billing_settings.prepaid_tax_point` ('topup' | 'consumption', default
 *   'topup'): where prepaid VAT is charged (F-D3).
 * - `billing_statements.vat_summary` jsonb: per-rate net / tax / gross of the
 *   period's prepaid debits (empty in `topup` mode).
 *
 * Hand-written like the package's earlier migrations: `yarn mercato db
 * generate` only diffs `@app` modules. Columns mirror `data/entities.ts` 1:1.
 */
export class Migration20261119000000_billing_operator_feedback extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "billing_items" add column if not exists "price_basis" text not null default 'net';`)
    this.addSql(
      `alter table "billing_items" add constraint "billing_items_price_basis_check" check ("price_basis" in ('net', 'gross'));`,
    )
    this.addSql(
      `alter table "billing_settings" add column if not exists "prepaid_tax_point" text not null default 'topup';`,
    )
    this.addSql(
      `alter table "billing_settings" add constraint "billing_settings_prepaid_tax_point_check" check ("prepaid_tax_point" in ('topup', 'consumption'));`,
    )
    this.addSql(`alter table "billing_statements" add column if not exists "vat_summary" jsonb null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "billing_statements" drop column if exists "vat_summary";`)
    this.addSql(`alter table "billing_settings" drop constraint if exists "billing_settings_prepaid_tax_point_check";`)
    this.addSql(`alter table "billing_settings" drop column if exists "prepaid_tax_point";`)
    this.addSql(`alter table "billing_items" drop constraint if exists "billing_items_price_basis_check";`)
    this.addSql(`alter table "billing_items" drop column if exists "price_basis";`)
  }
}
