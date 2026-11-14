import { Migration } from '@mikro-orm/migrations';

export class Migration20261113082347 extends Migration {

  override name = 'Migration20261113082347';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_pricing_tables" add "purpose" text not null default 'price';`);
    // Hand-added: MikroORM cannot express the value set.
    this.addSql(`alter table "cpq_pricing_tables" add constraint "cpq_pricing_tables_purpose_check" check ("purpose" in ('price', 'cost'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_pricing_tables" drop constraint if exists "cpq_pricing_tables_purpose_check";`);
    this.addSql(`alter table "cpq_pricing_tables" drop column "purpose";`);
  }

}
