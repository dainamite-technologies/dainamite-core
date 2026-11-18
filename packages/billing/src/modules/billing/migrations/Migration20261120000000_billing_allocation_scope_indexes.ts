import { Migration } from '@mikro-orm/migrations'

/**
 * `billing_allocations` lookup indexes lead with the tenant scope, like every
 * other billing table. Each allocation read filters by tenant + organization
 * plus the invoice, the source (payment / credit memo) or the account.
 *
 * Hand-written like the package's earlier migrations: `yarn mercato db
 * generate` only diffs `@app` modules. Indexes mirror `data/entities.ts` 1:1.
 */
export class Migration20261120000000_billing_allocation_scope_indexes extends Migration {
  async up(): Promise<void> {
    this.addSql(`drop index if exists "billing_allocations_source_idx";`)
    this.addSql(`drop index if exists "billing_allocations_invoice_idx";`)
    this.addSql(`drop index if exists "billing_allocations_account_idx";`)
    this.addSql(
      `create index if not exists "billing_allocations_source_idx" on "billing_allocations" ("tenant_id", "organization_id", "source_type", "source_id") where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "billing_allocations_invoice_idx" on "billing_allocations" ("tenant_id", "organization_id", "invoice_id") where "deleted_at" is null;`,
    )
    this.addSql(
      `create index if not exists "billing_allocations_account_idx" on "billing_allocations" ("tenant_id", "organization_id", "bill_account_id") where "deleted_at" is null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "billing_allocations_source_idx";`)
    this.addSql(`drop index if exists "billing_allocations_invoice_idx";`)
    this.addSql(`drop index if exists "billing_allocations_account_idx";`)
    this.addSql(`create index if not exists "billing_allocations_source_idx" on "billing_allocations" ("source_type", "source_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "billing_allocations_invoice_idx" on "billing_allocations" ("invoice_id") where "deleted_at" is null;`)
    this.addSql(`create index if not exists "billing_allocations_account_idx" on "billing_allocations" ("bill_account_id") where "deleted_at" is null;`)
  }
}
