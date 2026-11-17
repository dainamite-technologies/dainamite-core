import { Migration } from '@mikro-orm/migrations';

/**
 * #122 — a bundle component that was removed (soft-deleted) could never be
 * added back: the unique constraint on (org, tenant, offering, child offering)
 * also counted deleted rows. Replace it with a partial unique index over live
 * rows only, so V-COMP-5 applies to live components and removed ones stay as
 * history.
 */
export class Migration20261117120000_cpq_offering_components_partial_unique extends Migration {

  override name = 'Migration20261117120000_cpq_offering_components_partial_unique';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_offering_components" drop constraint if exists "cpq_off_comp_unique";`);
    this.addSql(`create unique index if not exists "cpq_off_comp_unique" on "cpq_offering_components" ("organization_id", "tenant_id", "offering_id", "child_offering_id") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "cpq_off_comp_unique";`);
    // The full constraint cannot hold once a child was removed and re-added.
    // Keep one row per (org, tenant, offering, child): the live row if there
    // is one, otherwise the most recently created. Older soft-deleted copies
    // are discarded — they are history only.
    this.addSql(`delete from "cpq_offering_components" c using (
      select "id", row_number() over (
        partition by "organization_id", "tenant_id", "offering_id", "child_offering_id"
        order by ("deleted_at" is null) desc, "created_at" desc, "id" desc
      ) as rn from "cpq_offering_components"
    ) ranked where c."id" = ranked."id" and ranked.rn > 1;`);
    this.addSql(`alter table "cpq_offering_components" add constraint "cpq_off_comp_unique" unique ("organization_id", "tenant_id", "offering_id", "child_offering_id");`);
  }

}
