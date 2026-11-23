import { Migration } from '@mikro-orm/migrations';

export class Migration20261113081626 extends Migration {

  override name = 'Migration20261113081626';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_product_charges" add "markup_rule" text null, add "markup_value" numeric(18, 4) null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_product_charges" drop column "markup_rule", drop column "markup_value";`);
  }

}
