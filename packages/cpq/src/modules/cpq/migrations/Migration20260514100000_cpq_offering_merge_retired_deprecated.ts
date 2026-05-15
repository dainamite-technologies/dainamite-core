import { Migration } from '@mikro-orm/migrations'

/**
 * Merge the `retired` lifecycle status into `deprecated` for product
 * offerings — same call as the earlier specifications merge
 * (`Migration20260514000000`). Reviewer wanted the offering UI to mirror
 * the specification's 3-state ladder, so we collapse the redundant state
 * and unify both surfaces through the single `LifecycleStatus` type and
 * `lifecycleStatusMap` in `components/statusMaps.ts`.
 *
 * Data-only migration: the underlying column is `text` so no schema
 * change is required. The Zod validator on the API now rejects
 * `'retired'` for new offering writes.
 */
export class Migration20260514100000_cpq_offering_merge_retired_deprecated extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `update "cpq_product_offerings" set "lifecycle_status" = 'deprecated' where "lifecycle_status" = 'retired';`,
    )
  }

  async down(): Promise<void> {
    // Lossy: there's no way to tell which rows were originally `retired`
    // vs originally `deprecated` once merged. Same rationale as the
    // specifications merge — leave down() as a no-op.
  }
}
