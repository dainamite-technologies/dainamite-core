import { Migration } from '@mikro-orm/migrations';

export class Migration20261116105841 extends Migration {

  override name = 'Migration20261116105841';

  override up(): void | Promise<void> {
    this.addSql(`create table "cpq_cost_expiry_warnings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_line_cost_id" uuid not null, "quote_id" uuid not null, "quote_line_id" uuid not null, "valid_until" date not null, "lead_days" int not null, "expired" boolean not null, "emitted_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "cpq_cost_expiry_warnings_emitted_idx" on "cpq_cost_expiry_warnings" ("organization_id", "tenant_id", "emitted_at");`);
    this.addSql(`alter table "cpq_cost_expiry_warnings" add constraint "cpq_cost_expiry_warnings_line_valid_until_unique" unique ("quote_line_cost_id", "valid_until");`);
    // Hand-added (the DB-less generator cannot express partial indexes): the expiry scan's candidate index (index-costs spec §Data Model).
    this.addSql(`create index "cpq_quote_line_costs_expiry_candidate_idx" on "cpq_quote_line_costs" ("organization_id", "tenant_id", "valid_until") where "deleted_at" is null and "role" = 'price_basis' and "value_status" = 'confirmed' and "valid_until" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "cpq_quote_line_costs_expiry_candidate_idx";`);
    this.addSql(`drop table if exists "cpq_cost_expiry_warnings";`);
  }

}
