import { Migration } from '@mikro-orm/migrations'

/**
 * Scale-prep indexes for the two highest-traffic CPQ list pages
 * (`/backend/cpq/offerings` and `/backend/cpq/specifications`).
 *
 * Why: both endpoints implement free-text search as
 * `$ilike '%term%'` against `code`, `name`, and `description`, which
 * forces a sequential scan on every request once row counts grow.
 * The default sort (`createdAt DESC`) also has no covering index, so
 * pagination of a filtered set degrades linearly with table size.
 *
 * Target: keep both lists snappy at 10k+ rows per tenant — production
 * customers are expected to import multiple thousands of offerings on
 * day one. Hand-written because MikroORM's schema generator does not
 * emit `pg_trgm` GIN operator classes or partial-index predicates.
 *
 * Indexes added per table (`cpq_product_offerings`, `cpq_product_specifications`):
 *  - GIN trigram on `code`, `name`, `description` (partial: `deleted_at IS NULL`)
 *  - B-tree `(organization_id, tenant_id, deleted_at, created_at DESC)`
 *    to cover the default-list scan + sort path.
 */
export class Migration20260514110000_cpq_list_search_indexes extends Migration {
  async up(): Promise<void> {
    this.addSql(`create extension if not exists "pg_trgm";`)

    // ── Offerings ────────────────────────────────────────────────
    this.addSql(
      `create index if not exists "cpq_product_offerings_code_trgm_idx"
         on "cpq_product_offerings" using gin ("code" gin_trgm_ops)
         where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "cpq_product_offerings_name_trgm_idx"
         on "cpq_product_offerings" using gin ("name" gin_trgm_ops)
         where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "cpq_product_offerings_description_trgm_idx"
         on "cpq_product_offerings" using gin ("description" gin_trgm_ops)
         where "deleted_at" is null and "description" is not null;`,
    )
    this.addSql(
      `create index if not exists "cpq_product_offerings_list_created_idx"
         on "cpq_product_offerings" ("organization_id", "tenant_id", "deleted_at", "created_at" desc);`,
    )

    // ── Specifications ───────────────────────────────────────────
    this.addSql(
      `create index if not exists "cpq_product_specifications_code_trgm_idx"
         on "cpq_product_specifications" using gin ("code" gin_trgm_ops)
         where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "cpq_product_specifications_name_trgm_idx"
         on "cpq_product_specifications" using gin ("name" gin_trgm_ops)
         where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "cpq_product_specifications_description_trgm_idx"
         on "cpq_product_specifications" using gin ("description" gin_trgm_ops)
         where "deleted_at" is null and "description" is not null;`,
    )
    this.addSql(
      `create index if not exists "cpq_product_specifications_list_created_idx"
         on "cpq_product_specifications" ("organization_id", "tenant_id", "deleted_at", "created_at" desc);`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "cpq_product_specifications_list_created_idx";`)
    this.addSql(`drop index if exists "cpq_product_specifications_description_trgm_idx";`)
    this.addSql(`drop index if exists "cpq_product_specifications_name_trgm_idx";`)
    this.addSql(`drop index if exists "cpq_product_specifications_code_trgm_idx";`)

    this.addSql(`drop index if exists "cpq_product_offerings_list_created_idx";`)
    this.addSql(`drop index if exists "cpq_product_offerings_description_trgm_idx";`)
    this.addSql(`drop index if exists "cpq_product_offerings_name_trgm_idx";`)
    this.addSql(`drop index if exists "cpq_product_offerings_code_trgm_idx";`)
    // Extension left in place — other modules may also rely on it.
  }
}
