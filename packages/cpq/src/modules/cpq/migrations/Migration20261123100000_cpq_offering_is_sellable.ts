import { Migration } from '@mikro-orm/migrations';

/**
 * #133 — offerings created only to be bundle components could be quoted on
 * their own. `is_sellable = false` (TMF620 `isSellable`) restricts an offering
 * to child lines under a bundle. `default_offering_sellable` on the spec only
 * pre-fills the flag on new offerings. Both default to true, so existing rows
 * keep today's behaviour.
 */
export class Migration20261123100000_cpq_offering_is_sellable extends Migration {

  override name = 'Migration20261123100000_cpq_offering_is_sellable';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_product_offerings" add column if not exists "is_sellable" boolean not null default true;`);
    this.addSql(`alter table "cpq_product_specifications" add column if not exists "default_offering_sellable" boolean not null default true;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_product_offerings" drop column if exists "is_sellable";`);
    this.addSql(`alter table "cpq_product_specifications" drop column if exists "default_offering_sellable";`);
  }

}
