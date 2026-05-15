import { Migration } from '@mikro-orm/migrations'

/**
 * Scale-prep indexes for the customer-inventory subscriptions list.
 *
 * `/backend/cpq/inventory` (Subscriptions tab) lets operators search by
 * code or name with `$ilike '%term%'`, which forces a sequential scan as
 * soon as a tenant accumulates a few thousand subscriptions. The new
 * "Expiring within X days" perspective filters by `currentTermEnd` —
 * already covered by `cpq_inventory_subscriptions_term_end_idx`, but
 * the default sort path `(organization_id, tenant_id, deleted_at,
 * created_at DESC)` had no covering index either.
 *
 * Target: keep the subscriptions list snappy at 10k+ subs per tenant
 * (production telecom-style customers easily hit that).
 *
 * Indexes added (`cpq_inventory_subscriptions`):
 *   - GIN trigram on `code` (partial: `deleted_at IS NULL`)
 *   - GIN trigram on `name` (partial: `deleted_at IS NULL`)
 *   - B-tree `(organization_id, tenant_id, deleted_at, created_at DESC)`
 *
 * Hand-written because MikroORM's schema generator can't emit
 * `gin_trgm_ops` or partial-index predicates. `pg_trgm` is already
 * installed by `Migration20260514110000_cpq_list_search_indexes`.
 */
export class Migration20260515000000_cpq_inventory_subscriptions_search_indexes extends Migration {
  async up(): Promise<void> {
    this.addSql(`create extension if not exists "pg_trgm";`)

    this.addSql(
      `create index if not exists "cpq_inventory_subscriptions_code_trgm_idx"
         on "cpq_inventory_subscriptions" using gin ("code" gin_trgm_ops)
         where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "cpq_inventory_subscriptions_name_trgm_idx"
         on "cpq_inventory_subscriptions" using gin ("name" gin_trgm_ops)
         where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "cpq_inventory_subscriptions_list_created_idx"
         on "cpq_inventory_subscriptions" ("organization_id", "tenant_id", "deleted_at", "created_at" desc);`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "cpq_inventory_subscriptions_list_created_idx";`)
    this.addSql(`drop index if exists "cpq_inventory_subscriptions_name_trgm_idx";`)
    this.addSql(`drop index if exists "cpq_inventory_subscriptions_code_trgm_idx";`)
    // pg_trgm extension left in place — owned by the earlier migration.
  }
}
