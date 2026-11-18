import { Migration } from '@mikro-orm/migrations'

/**
 * B2C billing accounts (Spec E, Phase 1).
 *
 * Adds `billing_accounts.customer_kind` ('company' | 'person'). Additive
 * only: existing accounts default to 'company', which is what they were
 * (the account form could only pick companies until now).
 *
 * Hand-written, like the package's earlier migrations: `yarn mercato db
 * generate` only diffs `@app` modules, so it never reaches this package
 * module. The column mirrors `data/entities.ts` 1:1 so a future generator
 * run diffs clean.
 */
export class Migration20261114000000_billing_customer_kind extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table "billing_accounts" add column if not exists "customer_kind" text not null default 'company';`,
    )
  }

  async down(): Promise<void> {
    this.addSql(`alter table "billing_accounts" drop column if exists "customer_kind";`)
  }
}
