import { Migration } from '@mikro-orm/migrations';

/**
 * Hand-written (the DB-less generator diffs entities only and cannot express CHECK constraints): supplier sourcing
 * (feature spec 2026-11-12-cpq-cost-plus-supplier-sourcing) writes `value_origin = 'supplier'` on answered cost lines,
 * which the feature-1 constraint `cpq_quote_line_costs_value_origin_check` (Migration20261113091043) did not allow.
 */
export class Migration20261115000100 extends Migration {

  override name = 'Migration20261115000100';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_line_costs" drop constraint if exists "cpq_quote_line_costs_value_origin_check";`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_value_origin_check" check ("value_origin" is null or "value_origin" in ('catalog', 'manual', 'supplier'));`);
  }

  override down(): void | Promise<void> {
    // Supplier-answered values are kept as manual values so the narrower constraint can be restored.
    this.addSql(`update "cpq_quote_line_costs" set "value_origin" = 'manual' where "value_origin" = 'supplier';`);
    this.addSql(`alter table "cpq_quote_line_costs" drop constraint if exists "cpq_quote_line_costs_value_origin_check";`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_value_origin_check" check ("value_origin" is null or "value_origin" in ('catalog', 'manual'));`);
  }

}
