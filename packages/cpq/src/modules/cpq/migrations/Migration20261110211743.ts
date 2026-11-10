import { Migration } from '@mikro-orm/migrations';

export class Migration20261110211743 extends Migration {

  override name = 'Migration20261110211743';

  override up(): void | Promise<void> {
    this.addSql(`create table "cpq_quote_price_adjustments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_configuration_id" uuid not null, "quote_id" uuid not null, "quote_line_id" uuid not null, "level" text not null, "charge_code" text null, "charge_type_filter" text null, "adjustment_type" text not null, "value" numeric(18, 4) not null, "currency_code" text null, "window_kind" text not null default 'relative', "from_month" int not null default 1, "to_month" int null, "reason_code" text not null, "reason_note" text null, "created_by_user_id" uuid not null, "updated_by_user_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cpq_qpa_quote_idx" on "cpq_quote_price_adjustments" ("organization_id", "tenant_id", "quote_id");`);
    this.addSql(`create index "cpq_qpa_quote_line_idx" on "cpq_quote_price_adjustments" ("organization_id", "tenant_id", "quote_line_id");`);
    this.addSql(`create index "cpq_qpa_quote_config_idx" on "cpq_quote_price_adjustments" ("organization_id", "tenant_id", "quote_configuration_id");`);

    this.addSql(`alter table "cpq_quote_configurations" add "pricing_revision" int not null default 0;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cpq_quote_configurations" drop column "pricing_revision";`);
  }

}
