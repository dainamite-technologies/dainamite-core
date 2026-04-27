import { Migration } from '@mikro-orm/migrations'

export class Migration20260412000000_cpq_bundled_offerings extends Migration {
  async up(): Promise<void> {
    // Extend CpqProductSpecification with spec_type and is_assetizable
    this.addSql(`alter table "cpq_product_specifications" add column "spec_type" text not null default 'simple';`)
    this.addSql(`alter table "cpq_product_specifications" add column "is_assetizable" boolean not null default false;`)

    // Extend CpqProductOffering with offering_type
    this.addSql(`alter table "cpq_product_offerings" add column "offering_type" text not null default 'simple';`)

    // CpqBundleSlot — structural slot within a bundle specification
    this.addSql(`create table "cpq_bundle_slots" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "spec_id" uuid not null, "target_spec_id" uuid not null, "component_group" text not null, "name" text not null, "description" text null, "cardinality_min" integer not null default 0, "cardinality_max" integer null, "sort_order" integer not null default 0, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_bundle_slots_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_bundle_slot_spec_idx" on "cpq_bundle_slots" ("organization_id", "tenant_id", "spec_id");`)
    this.addSql(`create index "cpq_bundle_slot_target_idx" on "cpq_bundle_slots" ("organization_id", "tenant_id", "target_spec_id");`)
    this.addSql(`create index "cpq_bundle_slot_group_idx" on "cpq_bundle_slots" ("organization_id", "tenant_id", "spec_id", "component_group");`)

    // CpqOfferingComponent — links bundle offering to component offerings
    this.addSql(`create table "cpq_offering_components" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "offering_id" uuid not null, "slot_id" uuid not null, "child_offering_id" uuid not null, "is_default" boolean not null default false, "sort_order" integer not null default 0, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "cpq_offering_components_pkey" primary key ("id"));`)
    this.addSql(`create index "cpq_off_comp_offering_idx" on "cpq_offering_components" ("organization_id", "tenant_id", "offering_id");`)
    this.addSql(`create index "cpq_off_comp_slot_idx" on "cpq_offering_components" ("organization_id", "tenant_id", "offering_id", "slot_id");`)
    this.addSql(`create index "cpq_off_comp_child_idx" on "cpq_offering_components" ("organization_id", "tenant_id", "child_offering_id");`)
    this.addSql(`alter table "cpq_offering_components" add constraint "cpq_off_comp_unique" unique ("organization_id", "tenant_id", "offering_id", "child_offering_id");`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_offering_components" cascade;`)
    this.addSql(`drop table if exists "cpq_bundle_slots" cascade;`)
    this.addSql(`alter table "cpq_product_offerings" drop column if exists "offering_type";`)
    this.addSql(`alter table "cpq_product_specifications" drop column if exists "is_assetizable";`)
    this.addSql(`alter table "cpq_product_specifications" drop column if exists "spec_type";`)
  }
}
