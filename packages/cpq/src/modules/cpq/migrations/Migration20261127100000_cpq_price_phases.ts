import { Migration } from '@mikro-orm/migrations';

/**
 * Spec 2026-11-26 price phases (Phase 2, D4 / D9 / D10).
 *
 * - `cpq_price_rules` gets a month range (`from_month` / `to_month`, months of
 *   the subscription the rule prices; default 1 → open = every month, today's
 *   behaviour) and optional campaign dates (`valid_from` / `valid_until`, which
 *   quotes get the rule).
 * - `cpq_quote_price_adjustments` gets an optional `phase_name` printed on the
 *   billing phase ("Free trial", "Year 1"). The month range itself reuses the
 *   existing `window_kind` / `from_month` / `to_month` columns.
 */
export class Migration20261127100000_cpq_price_phases extends Migration {

  override name = 'Migration20261127100000_cpq_price_phases';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_price_rules" add column if not exists "from_month" int not null default 1;`);
    this.addSql(`alter table "cpq_price_rules" add column if not exists "to_month" int null;`);
    this.addSql(`alter table "cpq_price_rules" add column if not exists "valid_from" date null;`);
    this.addSql(`alter table "cpq_price_rules" add column if not exists "valid_until" date null;`);
    this.addSql(`alter table "cpq_quote_price_adjustments" add column if not exists "phase_name" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_price_rules" drop column if exists "from_month";`);
    this.addSql(`alter table "cpq_price_rules" drop column if exists "to_month";`);
    this.addSql(`alter table "cpq_price_rules" drop column if exists "valid_from";`);
    this.addSql(`alter table "cpq_price_rules" drop column if exists "valid_until";`);
    this.addSql(`alter table "cpq_quote_price_adjustments" drop column if exists "phase_name";`);
  }

}
