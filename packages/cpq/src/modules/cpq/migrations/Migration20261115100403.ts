import { Migration } from '@mikro-orm/migrations';

export class Migration20261115100403 extends Migration {

  override name = 'Migration20261115100403';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_line_costs" add "fx_rate_source" text null, add "fx_rate_derivation" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_line_costs" drop column "fx_rate_source", drop column "fx_rate_derivation";`);
  }

}
