import { Migration } from '@mikro-orm/migrations'

/**
 * Credit / debit memos (Spec D). Memo columns `document_type`,
 * `corrects_invoice_id`, `correction_reason` and `credited_total` exist since
 * Spec 0; this adds the snapshot of the corrected document printed on the
 * memo. Additive, hand-written like the package's earlier migrations.
 */
export class Migration20261118000000_billing_memos extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table "billing_invoices" add column if not exists "corrects_invoice_number" text null, add column if not exists "corrects_issue_date" date null;`,
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `alter table "billing_invoices" drop column if exists "corrects_invoice_number", drop column if exists "corrects_issue_date";`,
    )
  }
}
