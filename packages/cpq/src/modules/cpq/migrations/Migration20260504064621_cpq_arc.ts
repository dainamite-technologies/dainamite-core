import { Migration } from '@mikro-orm/migrations'

/**
 * XD-250 ARC (Amend / Renew / Cancel) — Phase 1 schema.
 *
 * Adds:
 *   - `cpq_quote_target_subscriptions` (junction quote ↔ subscription target)
 *   - `cpq_subscription_change_logs` (append-only audit per ARC operation)
 *   - ARC discriminator + meta columns on `cpq_quote_configurations`
 *   - per-line target / source-item columns on `cpq_quote_line_configurations`
 *   - term-start, merged-into, last-change-log + optimistic-lock `version`
 *     on `cpq_inventory_subscriptions`
 */
export class Migration20260504064621_cpq_arc extends Migration {

  override async up(): Promise<void> {
    // ── New table: cpq_quote_target_subscriptions ─────────────────
    this.addSql(`create table "cpq_quote_target_subscriptions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_id" uuid not null, "subscription_id" uuid not null, "quote_type" text not null, "merge_action" text null, "new_term_start" date null, "new_term_end" date null, "new_term_months" int null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_quote_target_subscriptions_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_qts_sub_type_idx" on "cpq_quote_target_subscriptions" ("organization_id", "tenant_id", "subscription_id", "quote_type");`)
    this.addSql(`create index "cpq_qts_quote_idx" on "cpq_quote_target_subscriptions" ("organization_id", "tenant_id", "quote_id");`)
    this.addSql(`alter table "cpq_quote_target_subscriptions" add constraint "cpq_qts_quote_sub_unique" unique ("organization_id", "tenant_id", "quote_id", "subscription_id");`)

    // ── New table: cpq_subscription_change_logs (append-only audit) ──
    this.addSql(`create table "cpq_subscription_change_logs" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subscription_id" uuid not null, "change_type" text not null, "source_quote_id" uuid null, "source_order_id" uuid null, "performed_by_user_id" uuid null, "effective_at" timestamptz not null, "before_snapshot" jsonb null, "after_snapshot" jsonb null, "line_changes" jsonb null, "term_change" jsonb null, "merged_into_subscription_id" uuid null, "merged_from_subscription_ids" jsonb null, "reason_code" text null, "reason_text" text null, "etf_amount" numeric(18, 4) null, "etf_currency" text null, "created_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_subscription_change_logs_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_scl_merged_into_idx" on "cpq_subscription_change_logs" ("merged_into_subscription_id");`)
    this.addSql(`create index "cpq_scl_source_order_idx" on "cpq_subscription_change_logs" ("source_order_id");`)
    this.addSql(`create index "cpq_scl_sub_history_idx" on "cpq_subscription_change_logs" ("organization_id", "tenant_id", "subscription_id", "created_at");`)
    // Activation idempotency: PostgreSQL treats NULLs as distinct, so multiple
    // rows with NULL source_order_id can coexist for the same subscription.
    this.addSql(`alter table "cpq_subscription_change_logs" add constraint "cpq_scl_order_sub_unique" unique ("source_order_id", "subscription_id");`)

    // ── Existing table: cpq_inventory_subscriptions ───────────────
    // currentTermStart complements existing currentTermEnd; mergedIntoSubscriptionId
    // is set only when this row is a merge source; lastChangeLogId is a
    // convenience pointer; version is a MikroORM optimistic-lock counter.
    this.addSql(`alter table "cpq_inventory_subscriptions" add column "current_term_start" date null, add column "merged_into_subscription_id" uuid null, add column "last_change_log_id" uuid null, add column "version" int not null default 1;`)
    this.addSql(`create index "cpq_inventory_subscriptions_merged_into_idx" on "cpq_inventory_subscriptions" ("organization_id", "tenant_id", "merged_into_subscription_id");`)
    this.addSql(`create index "cpq_inventory_subscriptions_term_end_idx" on "cpq_inventory_subscriptions" ("organization_id", "tenant_id", "current_term_end");`)

    // ── Existing table: cpq_quote_configurations ──────────────────
    // quote_type discriminates ARC quotes; arc_reason_*/etf_*/merge_* fields
    // carry ARC meta forward to order activation.
    this.addSql(`alter table "cpq_quote_configurations" add column "quote_type" text not null default 'new', add column "arc_reason_code" text null, add column "arc_reason_text" text null, add column "arc_etf_amount" numeric(18, 4) null, add column "arc_etf_currency" text null, add column "arc_merge_new_term_start" date null, add column "arc_merge_new_term_end" date null, add column "arc_merge_new_term_months" int null, add column "arc_merge_new_sub_code" text null, add column "arc_merge_new_sub_name" text null;`)
    this.addSql(`create index "cpq_quote_configurations_quote_type_idx" on "cpq_quote_configurations" ("organization_id", "tenant_id", "quote_type");`)

    // ── Existing table: cpq_quote_line_configurations ─────────────
    // target_subscription_id identifies which target sub the line affects;
    // source_subscription_item_id points at the item being changed for
    // cancel/modify lines.
    this.addSql(`alter table "cpq_quote_line_configurations" add column "target_subscription_id" uuid null, add column "source_subscription_item_id" uuid null;`)
    this.addSql(`create index "cpq_qlc_target_sub_idx" on "cpq_quote_line_configurations" ("organization_id", "tenant_id", "target_subscription_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "cpq_qlc_target_sub_idx";`)
    this.addSql(`alter table "cpq_quote_line_configurations" drop column "target_subscription_id", drop column "source_subscription_item_id";`)

    this.addSql(`drop index "cpq_quote_configurations_quote_type_idx";`)
    this.addSql(`alter table "cpq_quote_configurations" drop column "quote_type", drop column "arc_reason_code", drop column "arc_reason_text", drop column "arc_etf_amount", drop column "arc_etf_currency", drop column "arc_merge_new_term_start", drop column "arc_merge_new_term_end", drop column "arc_merge_new_term_months", drop column "arc_merge_new_sub_code", drop column "arc_merge_new_sub_name";`)

    this.addSql(`drop index "cpq_inventory_subscriptions_merged_into_idx";`)
    this.addSql(`drop index "cpq_inventory_subscriptions_term_end_idx";`)
    this.addSql(`alter table "cpq_inventory_subscriptions" drop column "current_term_start", drop column "merged_into_subscription_id", drop column "last_change_log_id", drop column "version";`)

    this.addSql(`drop table if exists "cpq_subscription_change_logs" cascade;`)
    this.addSql(`drop table if exists "cpq_quote_target_subscriptions" cascade;`)
  }
}
