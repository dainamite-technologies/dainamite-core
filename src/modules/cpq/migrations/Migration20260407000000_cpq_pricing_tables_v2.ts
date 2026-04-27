import { Migration } from '@mikro-orm/migrations'

export class Migration20260407000000_cpq_pricing_tables_v2 extends Migration {
  async up(): Promise<void> {
    // CpqPricingTable: add currency_code_list, migrate data from currency_code, drop obsolete columns
    this.addSql(`alter table "cpq_pricing_tables" add column "currency_code_list" jsonb;`)
    this.addSql(`update "cpq_pricing_tables" set "currency_code_list" = jsonb_build_array(coalesce("currency_code", 'USD'));`)
    this.addSql(`alter table "cpq_pricing_tables" alter column "currency_code_list" set not null;`)
    this.addSql(`alter table "cpq_pricing_tables" drop column if exists "currency_code";`)
    this.addSql(`alter table "cpq_pricing_tables" drop column if exists "pricing_model";`)
    this.addSql(`alter table "cpq_pricing_tables" drop column if exists "product_id";`)
    this.addSql(`alter table "cpq_pricing_tables" drop column if exists "description";`)

    // CpqPricingTableEntry: add currency_code with default for existing rows
    this.addSql(`alter table "cpq_pricing_table_entries" add column "currency_code" text not null default 'USD';`)
  }

  async down(): Promise<void> {
    // Reverse entry changes
    this.addSql(`alter table "cpq_pricing_table_entries" drop column if exists "currency_code";`)

    // Reverse table changes: restore old columns, migrate data back
    this.addSql(`alter table "cpq_pricing_tables" add column "description" text null;`)
    this.addSql(`alter table "cpq_pricing_tables" add column "product_id" uuid null;`)
    this.addSql(`alter table "cpq_pricing_tables" add column "pricing_model" text not null default 'flat';`)
    this.addSql(`alter table "cpq_pricing_tables" add column "currency_code" text not null default 'USD';`)
    this.addSql(`update "cpq_pricing_tables" set "currency_code" = coalesce("currency_code_list"->>0, 'USD');`)
    this.addSql(`alter table "cpq_pricing_tables" drop column if exists "currency_code_list";`)
  }
}
