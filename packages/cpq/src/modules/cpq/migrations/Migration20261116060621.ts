import { Migration } from '@mikro-orm/migrations';

export class Migration20261116060621 extends Migration {

  override name = 'Migration20261116060621';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_charge_cost_elements" add "cost_index_id" uuid null, add "index_factor" numeric(18, 6) null, add "index_offset" numeric(18, 4) null;`);
    // Hand-added (the DB-less generator cannot express partial indexes or CHECK constraints): index-costs spec §Data Model.
    // No CHECK on `source` exists on cost elements / quote, order or inventory cost tables (only role, cost_type, origin,
    // value_origin, status), so the new `index` source needs no widening.
    this.addSql(`create index "cpq_charge_cost_elements_cost_index_idx" on "cpq_charge_cost_elements" ("organization_id", "tenant_id", "cost_index_id") where "deleted_at" is null and "cost_index_id" is not null;`);
    this.addSql(`alter table "cpq_charge_cost_elements" add constraint "cpq_charge_cost_elements_index_fields_check" check (("source" = 'index') = ("cost_index_id" is not null));`);
    this.addSql(`alter table "cpq_charge_cost_elements" add constraint "cpq_charge_cost_elements_index_factor_check" check ("index_factor" is null or "index_factor" > 0);`);
    this.addSql(`alter table "cpq_charge_cost_elements" add constraint "cpq_charge_cost_elements_index_offset_check" check ("index_offset" is null or "index_offset" >= 0);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_charge_cost_elements" drop constraint if exists "cpq_charge_cost_elements_index_offset_check";`);
    this.addSql(`alter table "cpq_charge_cost_elements" drop constraint if exists "cpq_charge_cost_elements_index_factor_check";`);
    this.addSql(`alter table "cpq_charge_cost_elements" drop constraint if exists "cpq_charge_cost_elements_index_fields_check";`);
    this.addSql(`drop index if exists "cpq_charge_cost_elements_cost_index_idx";`);
    // Index elements cannot survive without their columns: park them as inactive on-request elements.
    this.addSql(`update "cpq_charge_cost_elements" set "source" = 'on_request', "is_active" = false where "source" = 'index';`);
    this.addSql(`alter table "cpq_charge_cost_elements" drop column "cost_index_id", drop column "index_factor", drop column "index_offset";`);
  }

}
