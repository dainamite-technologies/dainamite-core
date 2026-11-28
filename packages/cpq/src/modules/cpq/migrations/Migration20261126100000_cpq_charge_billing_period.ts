import { Migration } from '@mikro-orm/migrations';

/**
 * Spec 2026-11-26 line period (D5) — a recurring charge has its own billing
 * period: its price is per `billing_period_interval × billing_period_unit`
 * (`month` | `year`). Defaults to every 1 month, so existing charges keep
 * today's behaviour.
 */
export class Migration20261126100000_cpq_charge_billing_period extends Migration {

  override name = 'Migration20261126100000_cpq_charge_billing_period';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_product_charges" add column if not exists "billing_period_unit" text not null default 'month';`);
    this.addSql(`alter table "cpq_product_charges" add column if not exists "billing_period_interval" int not null default 1;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_product_charges" drop column if exists "billing_period_unit";`);
    this.addSql(`alter table "cpq_product_charges" drop column if exists "billing_period_interval";`);
  }

}
