import { Migration } from '@mikro-orm/migrations';

export class Migration20261115151709 extends Migration {

  override name = 'Migration20261115151709';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_line_costs" add "renegotiation_due" boolean not null default false;`);
    // Hand-added (the DB-less generator cannot express CHECK constraints or partial indexes): ARC cost carry-over
    // (feature spec 2026-11-12-cpq-cost-plus-arc-costs) writes `origin = 'carried'` / `value_origin = 'carried'`, which
    // the constraints of Migration20261113091043 / Migration20261115000100 did not allow. `supplier` stays allowed.
    this.addSql(`alter table "cpq_quote_line_costs" drop constraint if exists "cpq_quote_line_costs_origin_check";`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_origin_check" check ("origin" in ('catalog', 'manual', 'carried'));`);
    this.addSql(`alter table "cpq_quote_line_costs" drop constraint if exists "cpq_quote_line_costs_value_origin_check";`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_value_origin_check" check ("value_origin" is null or "value_origin" in ('catalog', 'manual', 'supplier', 'carried'));`);
    // Open quotes carrying a given item cost (usage endpoint, support).
    this.addSql(`create index "cpq_quote_line_costs_carried_item_cost_idx" on "cpq_quote_line_costs" ("organization_id", "tenant_id", "carried_from_item_cost_id") where "deleted_at" is null and "carried_from_item_cost_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "cpq_quote_line_costs_carried_item_cost_idx";`);
    // Carried rows are kept as manual values so the narrower constraints can be restored.
    this.addSql(`update "cpq_quote_line_costs" set "origin" = 'manual' where "origin" = 'carried';`);
    this.addSql(`update "cpq_quote_line_costs" set "value_origin" = 'manual' where "value_origin" = 'carried';`);
    this.addSql(`alter table "cpq_quote_line_costs" drop constraint if exists "cpq_quote_line_costs_value_origin_check";`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_value_origin_check" check ("value_origin" is null or "value_origin" in ('catalog', 'manual', 'supplier'));`);
    this.addSql(`alter table "cpq_quote_line_costs" drop constraint if exists "cpq_quote_line_costs_origin_check";`);
    this.addSql(`alter table "cpq_quote_line_costs" add constraint "cpq_quote_line_costs_origin_check" check ("origin" in ('catalog', 'manual'));`);
    this.addSql(`alter table "cpq_quote_line_costs" drop column "renegotiation_due";`);
  }

}
