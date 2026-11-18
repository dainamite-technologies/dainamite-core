import { Migration } from '@mikro-orm/migrations';

export class Migration20261113091513 extends Migration {

  override name = 'Migration20261113091513';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_line_costs" add "driver_hash" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_line_costs" drop column "driver_hash";`);
  }

}
