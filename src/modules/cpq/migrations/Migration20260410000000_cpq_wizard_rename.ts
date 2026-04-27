import { Migration } from '@mikro-orm/migrations'

export class Migration20260410000000_cpq_wizard_rename extends Migration {
  async up(): Promise<void> {
    // ─── Drop workflow instances table (no longer persisted) ───────
    this.addSql(`drop table if exists "cpq_workflow_instances";`)

    // ─── Rename cpq_workflow_definitions → cpq_wizard_definitions ──
    this.addSql(`alter table "cpq_workflow_definitions" rename to "cpq_wizard_definitions";`)

    // ─── Rename constraints and indexes ───────────────────────────
    this.addSql(`alter table "cpq_wizard_definitions" rename constraint "cpq_workflow_definitions_pkey" to "cpq_wizard_definitions_pkey";`)
    this.addSql(`alter table "cpq_wizard_definitions" rename constraint "cpq_workflow_definitions_code_unique" to "cpq_wizard_definitions_code_unique";`)
    this.addSql(`alter index "cpq_workflow_definitions_active_idx" rename to "cpq_wizard_definitions_active_idx";`)
    this.addSql(`alter index "cpq_workflow_definitions_surface_idx" rename to "cpq_wizard_definitions_surface_idx";`)

    // ─── Add params_schema column ─────────────────────────────────
    this.addSql(`alter table "cpq_wizard_definitions" add column "params_schema" jsonb null;`)
  }

  async down(): Promise<void> {
    // ─── Remove params_schema column ──────────────────────────────
    this.addSql(`alter table "cpq_wizard_definitions" drop column if exists "params_schema";`)

    // ─── Rename back ──────────────────────────────────────────────
    this.addSql(`alter index "cpq_wizard_definitions_active_idx" rename to "cpq_workflow_definitions_active_idx";`)
    this.addSql(`alter index "cpq_wizard_definitions_surface_idx" rename to "cpq_workflow_definitions_surface_idx";`)
    this.addSql(`alter table "cpq_wizard_definitions" rename constraint "cpq_wizard_definitions_code_unique" to "cpq_workflow_definitions_code_unique";`)
    this.addSql(`alter table "cpq_wizard_definitions" rename constraint "cpq_wizard_definitions_pkey" to "cpq_workflow_definitions_pkey";`)
    this.addSql(`alter table "cpq_wizard_definitions" rename to "cpq_workflow_definitions";`)

    // ─── Recreate workflow instances table ─────────────────────────
    this.addSql(`create table "cpq_workflow_instances" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "workflow_definition_id" uuid not null,
      "definition_version" int not null,
      "quote_id" uuid null,
      "quote_configuration_id" uuid null,
      "customer_id" uuid null,
      "current_step_id" text not null,
      "completed_steps" jsonb not null default '[]',
      "step_data" jsonb not null default '{}',
      "status" text not null default 'active',
      "started_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "cpq_workflow_instances_pkey" primary key ("id")
    );`)
    this.addSql(`create index "cpq_workflow_instances_def_idx" on "cpq_workflow_instances" ("organization_id", "tenant_id", "workflow_definition_id");`)
    this.addSql(`create index "cpq_workflow_instances_quote_idx" on "cpq_workflow_instances" ("organization_id", "tenant_id", "quote_id");`)
    this.addSql(`create index "cpq_workflow_instances_user_idx" on "cpq_workflow_instances" ("organization_id", "tenant_id", "started_by", "status");`)
    this.addSql(`create index "cpq_workflow_instances_customer_idx" on "cpq_workflow_instances" ("organization_id", "tenant_id", "customer_id");`)
  }
}
