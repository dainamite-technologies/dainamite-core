import { Migration } from '@mikro-orm/migrations';

export class Migration20261114192129 extends Migration {

  override name = 'Migration20261114192129';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_line_costs" add "proposed_answer" jsonb null, add "request_history" jsonb not null default '[]', add "request_supplier_id" uuid null, add "request_supplier_name" text null, add "last_answer_hash" text null, add "cancel_reason" text null;`);
    this.addSql(`create index "cpq_quote_line_costs_request_idx" on "cpq_quote_line_costs" ("cost_request_id");`);
    this.addSql(`create index "cpq_quote_line_costs_sourcing_queue_idx" on "cpq_quote_line_costs" ("organization_id", "tenant_id", "sourcing_status", "requested_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "cpq_quote_line_costs_request_idx";`);
    this.addSql(`drop index "cpq_quote_line_costs_sourcing_queue_idx";`);
    this.addSql(`alter table "cpq_quote_line_costs" drop column "proposed_answer", drop column "request_history", drop column "request_supplier_id", drop column "request_supplier_name", drop column "last_answer_hash", drop column "cancel_reason";`);
  }

}
