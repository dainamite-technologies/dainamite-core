import { Migration } from '@mikro-orm/migrations';

export class Migration20261115102552 extends Migration {

  override name = 'Migration20261115102552';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_inventory_costs" add "fx_rate_source" text null, add "fx_rate_derivation" text null;`);

    this.addSql(`alter table "cpq_order_line_costs" add "fx_rate_source" text null, add "fx_rate_derivation" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_inventory_costs" drop column "fx_rate_source", drop column "fx_rate_derivation";`);

    this.addSql(`alter table "cpq_order_line_costs" drop column "fx_rate_source", drop column "fx_rate_derivation";`);
  }

}
