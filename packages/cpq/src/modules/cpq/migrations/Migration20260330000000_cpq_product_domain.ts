import { Migration } from '@mikro-orm/migrations'

export class Migration20260330000000_cpq_product_domain extends Migration {
  async up(): Promise<void> {
    // ─── New tables ──────────────────────────────────────────────────

    // cpq_product_specifications
    this.addSql(`create table "cpq_product_specifications" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "code" text not null, "name" text not null, "description" text null, "lifecycle_status" text not null default 'draft', "version" int not null default 1, "effective_from" timestamptz null, "effective_to" timestamptz null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_product_specifications_pkey" primary key ("id"));`)
    this.addSql(`alter table "cpq_product_specifications" add constraint "cpq_product_specifications_product_unique" unique ("organization_id", "tenant_id", "product_id");`)
    this.addSql(`alter table "cpq_product_specifications" add constraint "cpq_product_specifications_code_unique" unique ("organization_id", "tenant_id", "code");`)
    this.addSql(`create index "cpq_product_specifications_lifecycle_idx" on "cpq_product_specifications" ("organization_id", "tenant_id", "lifecycle_status");`)

    // cpq_product_offerings
    this.addSql(`create table "cpq_product_offerings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "spec_id" uuid not null, "catalog_offer_id" uuid null, "code" text not null, "name" text not null, "description" text null, "design_time_values" jsonb not null default '{}', "lifecycle_status" text not null default 'draft', "effective_from" timestamptz null, "effective_to" timestamptz null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_product_offerings_pkey" primary key ("id"));`)
    this.addSql(`alter table "cpq_product_offerings" add constraint "cpq_product_offerings_code_unique" unique ("organization_id", "tenant_id", "code");`)
    this.addSql(`create index "cpq_product_offerings_spec_idx" on "cpq_product_offerings" ("organization_id", "tenant_id", "spec_id");`)
    this.addSql(`create index "cpq_product_offerings_lifecycle_idx" on "cpq_product_offerings" ("organization_id", "tenant_id", "lifecycle_status");`)

    // cpq_product_relationships
    this.addSql(`create table "cpq_product_relationships" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "source_spec_id" uuid not null, "target_spec_id" uuid not null, "relationship_type" text not null, "cardinality_min" int not null default 0, "cardinality_max" int null, "condition" jsonb null, "metadata" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_product_relationships_pkey" primary key ("id"));`)
    this.addSql(`alter table "cpq_product_relationships" add constraint "cpq_product_relationships_unique" unique ("organization_id", "tenant_id", "source_spec_id", "target_spec_id", "relationship_type");`)
    this.addSql(`create index "cpq_product_relationships_source_idx" on "cpq_product_relationships" ("organization_id", "tenant_id", "source_spec_id");`)
    this.addSql(`create index "cpq_product_relationships_target_idx" on "cpq_product_relationships" ("organization_id", "tenant_id", "target_spec_id");`)

    // ─── Alter existing tables ───────────────────────────────────────

    // cpq_product_attributes — add v2 columns
    this.addSql(`alter table "cpq_product_attributes" add column "spec_id" uuid null;`)
    this.addSql(`alter table "cpq_product_attributes" add column "resolution_time" text not null default 'run_time';`)
    this.addSql(`alter table "cpq_product_attributes" add column "reference_entity" text null;`)
    this.addSql(`alter table "cpq_product_attributes" add column "reference_filter" jsonb null;`)
    this.addSql(`alter table "cpq_product_attributes" add column "depends_on" jsonb null;`)
    this.addSql(`alter table "cpq_product_attributes" add column "default_value" jsonb null;`)
    this.addSql(`alter table "cpq_product_attributes" add column "help_text" text null;`)
    this.addSql(`create index "cpq_product_attributes_spec_idx" on "cpq_product_attributes" ("organization_id", "tenant_id", "spec_id");`)
    this.addSql(`create index "cpq_product_attributes_spec_resolution_idx" on "cpq_product_attributes" ("organization_id", "tenant_id", "spec_id", "resolution_time");`)

    // cpq_product_charges — add v2 columns
    this.addSql(`alter table "cpq_product_charges" add column "offering_id" uuid null;`)
    this.addSql(`alter table "cpq_product_charges" add column "fixed_price" numeric null;`)
    this.addSql(`alter table "cpq_product_charges" add column "currency_code" text null;`)
    this.addSql(`alter table "cpq_product_charges" add column "description" text null;`)
    this.addSql(`create index "cpq_product_charges_offering_idx" on "cpq_product_charges" ("organization_id", "tenant_id", "offering_id");`)
  }

  async down(): Promise<void> {
    // Drop new tables
    this.addSql(`drop table if exists "cpq_product_relationships" cascade;`)
    this.addSql(`drop table if exists "cpq_product_offerings" cascade;`)
    this.addSql(`drop table if exists "cpq_product_specifications" cascade;`)

    // Remove added columns from cpq_product_attributes
    this.addSql(`drop index if exists "cpq_product_attributes_spec_idx";`)
    this.addSql(`drop index if exists "cpq_product_attributes_spec_resolution_idx";`)
    this.addSql(`alter table "cpq_product_attributes" drop column if exists "spec_id";`)
    this.addSql(`alter table "cpq_product_attributes" drop column if exists "resolution_time";`)
    this.addSql(`alter table "cpq_product_attributes" drop column if exists "reference_entity";`)
    this.addSql(`alter table "cpq_product_attributes" drop column if exists "reference_filter";`)
    this.addSql(`alter table "cpq_product_attributes" drop column if exists "depends_on";`)
    this.addSql(`alter table "cpq_product_attributes" drop column if exists "default_value";`)
    this.addSql(`alter table "cpq_product_attributes" drop column if exists "help_text";`)

    // Remove added columns from cpq_product_charges
    this.addSql(`drop index if exists "cpq_product_charges_offering_idx";`)
    this.addSql(`alter table "cpq_product_charges" drop column if exists "offering_id";`)
    this.addSql(`alter table "cpq_product_charges" drop column if exists "fixed_price";`)
    this.addSql(`alter table "cpq_product_charges" drop column if exists "currency_code";`)
    this.addSql(`alter table "cpq_product_charges" drop column if exists "description";`)
  }
}
