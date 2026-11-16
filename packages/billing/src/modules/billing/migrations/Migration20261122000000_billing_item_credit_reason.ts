import { Migration } from '@mikro-orm/migrations'

/**
 * Credit reason on billing items (2026-11-16 operator polish spec, Part 2, D8).
 *
 * `billing_items.credit_reason` jsonb: why ending the item credited days
 * already billed — operator text `{ kind: 'text', text }` or a generated code
 * `{ kind: 'code', code, params }` rendered in the invoice language. Bill Runs
 * copy it into the credit line's `metadata.credit_reason`.
 *
 * Hand-written like the package's earlier migrations: `yarn mercato db
 * generate` only diffs `@app` modules. The column mirrors `data/entities.ts`.
 */
export class Migration20261122000000_billing_item_credit_reason extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "billing_items" add column if not exists "credit_reason" jsonb null;`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "billing_items" drop column if exists "credit_reason";`)
  }
}
