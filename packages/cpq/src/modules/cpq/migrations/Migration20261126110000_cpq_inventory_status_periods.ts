import { Migration } from '@mikro-orm/migrations';

/**
 * Spec 2026-11-26 line status (D6) — CPQ subscriptions and their items can be
 * paused, suspended or put in a grace period from a date to a date (open end
 * allowed), with a billing charge behaviour and a reason. The statuses
 * themselves are text values (`paused`, `grace` join the XD-215 set); these
 * columns hold the current stop period. All nullable: existing rows unchanged.
 */
export class Migration20261126110000_cpq_inventory_status_periods extends Migration {

  override name = 'Migration20261126110000_cpq_inventory_status_periods';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_inventory_subscriptions" add column if not exists "status_from_date" date null;`);
    this.addSql(`alter table "cpq_inventory_subscriptions" add column if not exists "status_to_date" date null;`);
    this.addSql(`alter table "cpq_inventory_subscriptions" add column if not exists "status_charge_behavior" text null;`);
    this.addSql(`alter table "cpq_inventory_subscriptions" add column if not exists "status_reason" text null;`);
    this.addSql(`alter table "cpq_inventory_subscription_items" add column if not exists "status_from_date" date null;`);
    this.addSql(`alter table "cpq_inventory_subscription_items" add column if not exists "status_to_date" date null;`);
    this.addSql(`alter table "cpq_inventory_subscription_items" add column if not exists "status_charge_behavior" text null;`);
    this.addSql(`alter table "cpq_inventory_subscription_items" add column if not exists "status_reason" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_inventory_subscriptions" drop column if exists "status_from_date";`);
    this.addSql(`alter table "cpq_inventory_subscriptions" drop column if exists "status_to_date";`);
    this.addSql(`alter table "cpq_inventory_subscriptions" drop column if exists "status_charge_behavior";`);
    this.addSql(`alter table "cpq_inventory_subscriptions" drop column if exists "status_reason";`);
    this.addSql(`alter table "cpq_inventory_subscription_items" drop column if exists "status_from_date";`);
    this.addSql(`alter table "cpq_inventory_subscription_items" drop column if exists "status_to_date";`);
    this.addSql(`alter table "cpq_inventory_subscription_items" drop column if exists "status_charge_behavior";`);
    this.addSql(`alter table "cpq_inventory_subscription_items" drop column if exists "status_reason";`);
  }

}
