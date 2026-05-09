import { Migration } from '@mikro-orm/migrations'

export class Migration20260402000000_cpq_workflows extends Migration {
  async up(): Promise<void> {
    // ─── New table: cpq_workflow_definitions ───────────────────────
    this.addSql(`create table "cpq_workflow_definitions" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "code" text not null,
      "name" text not null,
      "description" text null,
      "version" int not null default 1,
      "steps" jsonb not null default '[]',
      "applicability" jsonb null,
      "surface" text not null default 'backend',
      "is_active" boolean not null default true,
      "metadata" jsonb null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "cpq_workflow_definitions_pkey" primary key ("id")
    );`)

    this.addSql(`alter table "cpq_workflow_definitions" add constraint "cpq_workflow_definitions_code_unique" unique ("organization_id", "tenant_id", "code");`)
    this.addSql(`create index "cpq_workflow_definitions_active_idx" on "cpq_workflow_definitions" ("organization_id", "tenant_id", "is_active");`)
    this.addSql(`create index "cpq_workflow_definitions_surface_idx" on "cpq_workflow_definitions" ("organization_id", "tenant_id", "surface");`)

    // ─── New table: cpq_workflow_instances ─────────────────────────
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

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_workflow_instances";`)
    this.addSql(`drop table if exists "cpq_workflow_definitions";`)
  }
}
