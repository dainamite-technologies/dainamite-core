import { Migration } from '@mikro-orm/migrations';

export class Migration20261116054402 extends Migration {

  override name = 'Migration20261116054402';

  override up(): void | Promise<void> {
    this.addSql(`create table "cpq_cost_indices" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "unit" text not null, "currency_code" text not null, "description" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cpq_cost_indices_active_idx" on "cpq_cost_indices" ("organization_id", "tenant_id", "is_active");`);
    // Hand-added (MikroORM cannot express partial indexes): the index code is unique per tenant among non-deleted indices.
    this.addSql(`create unique index "cpq_cost_indices_code_unique" on "cpq_cost_indices" ("tenant_id", "code") where "deleted_at" is null;`);

    this.addSql(`create table "cpq_cost_index_values" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "cost_index_id" uuid not null, "effective_date" date not null, "value" numeric(18, 6) not null, "revision" int not null, "source_note" text null, "import_batch_id" uuid null, "created_by_user_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "cpq_cost_index_values_lookup_idx" on "cpq_cost_index_values" ("organization_id", "tenant_id", "cost_index_id", "effective_date", "revision");`);
    this.addSql(`alter table "cpq_cost_index_values" add constraint "cpq_cost_index_values_key_unique" unique ("cost_index_id", "effective_date", "revision");`);
    // Hand-added (MikroORM cannot express CHECK constraints): index values are strictly positive (spec Q9 / Data Model).
    this.addSql(`alter table "cpq_cost_index_values" add constraint "cpq_cost_index_values_value_check" check ("value" > 0);`);
    this.addSql(`alter table "cpq_cost_index_values" add constraint "cpq_cost_index_values_revision_check" check ("revision" >= 1);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "cpq_cost_index_values" cascade;`);
    this.addSql(`drop table if exists "cpq_cost_indices" cascade;`);
  }

}
