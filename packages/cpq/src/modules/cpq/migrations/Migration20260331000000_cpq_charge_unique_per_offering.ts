import { Migration } from '@mikro-orm/migrations'

export class Migration20260331000000_cpq_charge_unique_per_offering extends Migration {
  async up(): Promise<void> {
    // Drop the old unique constraint scoped to product_id
    this.addSql(`alter table "cpq_product_charges" drop constraint if exists "cpq_product_charges_code_unique";`)
    // Add new unique constraint scoped to offering_id (for v2 charges)
    this.addSql(`alter table "cpq_product_charges" add constraint "cpq_product_charges_offering_code_unique" unique ("organization_id", "tenant_id", "offering_id", "code");`)
  }

  async down(): Promise<void> {
    this.addSql(`alter table "cpq_product_charges" drop constraint if exists "cpq_product_charges_offering_code_unique";`)
    this.addSql(`alter table "cpq_product_charges" add constraint "cpq_product_charges_code_unique" unique ("organization_id", "tenant_id", "product_id", "code");`)
  }
}
