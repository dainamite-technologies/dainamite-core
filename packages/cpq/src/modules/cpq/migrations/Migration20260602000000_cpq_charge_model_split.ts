import { Migration } from '@mikro-orm/migrations'

/**
 * XD-297 — split the charge "shape" into two orthogonal axes.
 *
 * Before: `cpq_product_charges.pricing_method` conflated *how quantity drives
 * the charge* (flat | per_unit | tiered) with *where the price comes from*
 * (a fixed price for `flat`, a table lookup for `per_unit` / `tiered`).
 *
 * After:
 *   - `charge_model`   — flat | per_unit | volume | tiered  (new column)
 *   - `pricing_method` — fixed | table                       (repurposed)
 *
 * The backfill maps every legacy row to the equivalent split shape:
 *   flat     → (charge_model=flat,     pricing_method=fixed)
 *   per_unit → (charge_model=per_unit, pricing_method=table)
 *   tiered   → (charge_model=tiered,   pricing_method=table)
 *
 * Hand-written because the data backfill (re-coding existing `pricing_method`
 * values) is beyond what MikroORM's schema generator can emit. The pricing
 * service additionally normalises any row that predates this migration, so the
 * change is safe even before it is applied.
 */
export class Migration20260602000000_cpq_charge_model_split extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "cpq_product_charges" add column "charge_model" text null;`)

    // Derive charge_model from the legacy combined pricing_method FIRST …
    this.addSql(`update "cpq_product_charges" set "charge_model" = case
      when "pricing_method" = 'per_unit' then 'per_unit'
      when "pricing_method" = 'tiered' then 'tiered'
      else 'flat'
    end where "charge_model" is null;`)

    // … then collapse pricing_method to the new {fixed, table} axis.
    this.addSql(`update "cpq_product_charges" set "pricing_method" = case
      when "pricing_method" in ('per_unit', 'tiered', 'volume', 'table') then 'table'
      else 'fixed'
    end;`)
  }

  async down(): Promise<void> {
    // Best-effort re-collapse to the legacy combined value. Combinations that
    // only exist post-split (flat+table, per_unit+fixed) map to their nearest
    // legacy model; `volume` has no legacy equivalent and falls back to per_unit.
    this.addSql(`update "cpq_product_charges" set "pricing_method" = case
      when "charge_model" = 'tiered' then 'tiered'
      when "charge_model" = 'per_unit' then 'per_unit'
      when "charge_model" = 'volume' then 'per_unit'
      else 'flat'
    end;`)

    this.addSql(`alter table "cpq_product_charges" drop column "charge_model";`)
  }
}
