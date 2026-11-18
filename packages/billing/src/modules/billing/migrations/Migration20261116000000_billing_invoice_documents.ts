import { Migration } from '@mikro-orm/migrations'

/**
 * Invoice documents (Spec B): VAT per item, payment terms, seller settings.
 *
 *   - `billing_items.tax_rate` — existing items get 0 (P-D5: no back-fill, a
 *     default would silently re-price live subscriptions; demo data reseeds);
 *   - `billing_accounts.payment_terms_days` / `auto_send_invoice`;
 *   - `billing_settings` seller block, bank, footer, logo, default terms and
 *     default tax rate.
 *
 * Additive only. Hand-written like the package's earlier migrations (`yarn
 * mercato db generate` only diffs `@app` modules); columns mirror
 * `data/entities.ts` 1:1.
 */
export class Migration20261116000000_billing_invoice_documents extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table "billing_items" add column if not exists "tax_rate" numeric(7, 4) not null default '0';`,
    )
    this.addSql(
      `alter table "billing_accounts" add column if not exists "payment_terms_days" int null, add column if not exists "auto_send_invoice" boolean not null default false;`,
    )
    this.addSql(
      `alter table "billing_settings"
        add column if not exists "legal_name" text null,
        add column if not exists "seller_address" jsonb null,
        add column if not exists "tax_id" text null,
        add column if not exists "bank_name" text null,
        add column if not exists "iban" text null,
        add column if not exists "bic" text null,
        add column if not exists "invoice_footer" text null,
        add column if not exists "logo_attachment_id" uuid null,
        add column if not exists "default_payment_terms_days" int not null default 14,
        add column if not exists "default_tax_rate" numeric(7, 4) not null default '23';`,
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `alter table "billing_settings"
        drop column if exists "legal_name",
        drop column if exists "seller_address",
        drop column if exists "tax_id",
        drop column if exists "bank_name",
        drop column if exists "iban",
        drop column if exists "bic",
        drop column if exists "invoice_footer",
        drop column if exists "logo_attachment_id",
        drop column if exists "default_payment_terms_days",
        drop column if exists "default_tax_rate";`,
    )
    this.addSql(
      `alter table "billing_accounts" drop column if exists "payment_terms_days", drop column if exists "auto_send_invoice";`,
    )
    this.addSql(`alter table "billing_items" drop column if exists "tax_rate";`)
  }
}
