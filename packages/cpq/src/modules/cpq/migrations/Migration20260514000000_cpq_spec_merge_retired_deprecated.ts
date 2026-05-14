import { Migration } from '@mikro-orm/migrations'

/**
 * Merge the `retired` lifecycle status into `deprecated` for product
 * specifications. Reviewers found the two states redundant for spec
 * semantics (`deprecated` already conveys "do not use for new work").
 *
 * Scope: ONLY `cpq_product_specifications`. Offerings keep four states
 * because the user-facing semantics differ — a `retired` offering cannot
 * be sold at all, while `deprecated` offerings can still be sold but are
 * discouraged. That distinction does not apply at the specification
 * level (specs describe the product shape, not the sellability).
 *
 * Data-only migration: the underlying column is `text` so no schema
 * change is required. The Zod validator on the API now rejects
 * `'retired'` for new writes.
 */
export class Migration20260514000000_cpq_spec_merge_retired_deprecated extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `update "cpq_product_specifications" set "lifecycle_status" = 'deprecated' where "lifecycle_status" = 'retired';`,
    )
  }

  async down(): Promise<void> {
    // Lossy: there's no way to know which rows were originally `retired`
    // vs originally `deprecated` once the merge runs. Down() is a no-op
    // so a rollback doesn't silently fabricate a status.
  }
}
