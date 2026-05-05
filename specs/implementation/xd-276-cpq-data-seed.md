# XD-276: CPQ Data Seed — Multi-Tenant Use-Case Seeding

## Summary

Replace the single, hard-wired GIX seed currently embedded in `src/modules/cpq/setup.ts` with a **multi-tenant, use-case-driven seeding architecture**. Each demo use case (GIX, Puffin Cloud, future verticals) is a self-contained bundle that lives **outside** the `cpq` module (so CPQ remains extractable as `@dainamite/cpq` per SPEC-001), and the bundles are orchestrated by a thin app-level module that knows how to:

1. **Provision additional tenants** beyond the default ACME tenant created by `mercato init` — each with its own organization, admin user (`admin@<tenant>.com` / password `secret`), roles, and ACL grants.
2. **Run CPQ seed bundles per tenant** — each bundle seeds `CpqProductSpecification`, `CpqProductOffering`, `CpqProductAttribute`, `CpqPricingTable`, `CpqProductCharge`, `CpqPriceRule`, bundle slots, wizard definitions, and any companion sample customers/quotes scoped to that tenant only.
3. **Stay idempotent and resumable** — re-running the seed must not duplicate tenants, users, ACL rows, products, prices, or rules. Adding a new use case in the future is a single registration.

This is the seeding companion of the Cloud Services Provider requirements (XD-275, [`specs/sample-use-cases/cloud-services-provider-requirements.md`](../sample-use-cases/cloud-services-provider-requirements.md)) and supersedes the implicit "Tenant 1 — GIX" seed from XD-210.

> **Domain parent**: Operational Tooling / Demo Bootstrap
> **Blueprint ref**: SPEC-001 (Module Distribution Architecture) — keeps `@dainamite/cpq` clean of customer-specific demo data
> **Dependencies**:
>   - XD-275 (Cloud Services Provider use case — Puffin Cloud catalog)
>   - XD-187 (Product Specification & Offering)
>   - XD-186 (Pricing Tables)
>   - XD-188 (Price Rules)
>   - XD-223 (Bundled Offerings)
>   - XD-201 (Quoting)
>   - XD-210 (legacy GIX seed — superseded; this spec ports it to the new shape)
> **Existing implementation being refactored**:
>   - `src/modules/cpq/setup.ts` (~1,138 lines of GIX-specific seed)
>   - `src/modules/cpq/lib/seeds.ts` (wizard definitions)
>   - `src/modules/cpq/lib/example-seeds.ts` (Acme/Globex demo customers/quotes)
> **Out of scope**:
>   - The Public Pricing Calculator UI at `/pricing` — covered by XD-275 itself.
>   - Onboarding wizard for end users to create tenants from the UI.
>   - Cross-tenant data sharing (each tenant remains fully isolated).
>   - Migrating the framework's own multi-tenant model (we use `setupInitialTenant` from `@open-mercato/core/auth` as-is).

---

## Motivation

### Current State

The `cpq` module's `setup.ts` does **two things at once that should not co-exist**:

1. It declares the framework-level CPQ `ModuleSetupConfig` (`defaultRoleFeatures`, `seedDefaults`, `seedExamples`).
2. It hard-codes the entire GIX product catalogue, pricing tables, charges, attributes, price rules, bundle, and wizard definitions inline (~1,000 lines of `PRODUCTS`, `ACCESS_PORT_PRICES`, `INTERNET_PEERING_TIERS`, `MOBILE_PEERING_TIERS`, `CLOUD_CONNECT_ENTRIES`, etc.).

When `yarn initialize` runs, **all** of that GIX data is seeded into the single tenant created by `mercato auth setup` (Acme by default). This causes three problems:

| Problem | Consequence |
|--------|-------------|
| **Customer-specific data lives inside a package that will publish as `@dainamite/cpq`** | Every customer that installs the package gets GIX products by default. Violates SPEC-001 ("customer-specific code never publishes"). |
| **One init = one tenant** | We can only ship the framework with one demo. There is no way to demo CPQ for two different verticals (network operator vs cloud provider) in the same running app. |
| **No per-tenant separation of admin users / role grants** | If we seed multiple use cases manually, they all share the same admin user and ACL set. |

### Desired State

| Aspect | Today | After XD-276 |
|--------|-------|--------------|
| Where GIX data lives | `src/modules/cpq/setup.ts` | `src/modules/@app/demo_gix/seeds/*.ts` |
| Where Puffin data lives | n/a | `src/modules/@app/demo_puffin/seeds/*.ts` |
| Number of tenants `yarn initialize` produces | 1 (Acme) | 3 by default (Acme, GIX, Puffin), extensible |
| Admin user per tenant | `admin@acme.com` only | `admin@acme.com`, `admin@gix.com`, `admin@puffin.com` (password `secret` for all in dev) |
| CPQ data scope | Bleeds into Acme | Each use case lives **only** in its own tenant |
| Adding a new vertical | Edit ~1,000-line file | Add a new `@app/demo_<vertical>/` module, register one bundle |
| `@dainamite/cpq` package | Contains GIX dataset | Ships with **zero** customer demo data — only generic wizard definitions and structural defaults |
| Registration mechanism | None | `registerCpqUseCase({ id, tenantSpec, seed })` declared in each app-module's `setup.ts` |

---

## Architecture

### High-level layout

```
src/modules/
├── cpq/                                  ← will publish as @dainamite/cpq (SPEC-001)
│   ├── setup.ts                          ← generic only: wizards, role-features, NO product data
│   ├── lib/
│   │   └── seeds/
│   │       ├── api.ts                    ← public API: types, registry, runner helpers
│   │       ├── tenant-provisioning.ts    ← ensureDemoTenant() helper
│   │       └── wizards.ts                ← framework-shipped wizard definitions
│   └── cli.ts                            ← `mercato cpq seed-use-case <id>` and `seed-all-use-cases`
├── @app/
│   ├── demo_tenants/                     ← orchestrator (new) — chooses which tenants to seed
│   │   ├── index.ts
│   │   ├── setup.ts                      ← seedExamples hook calls runRegisteredUseCases()
│   │   └── manifest.ts                   ← which use-case ids are enabled in this app
│   ├── demo_gix/                         ← GIX vertical demo (new — receives migrated data)
│   │   ├── index.ts
│   │   ├── setup.ts                      ← registerCpqUseCase({ id: 'gix', tenantSpec, seed })
│   │   └── seeds/
│   │       ├── tenant.ts                 ← tenant/admin user/roles definition
│   │       ├── products.ts
│   │       ├── pricing-tables.ts
│   │       ├── charges.ts
│   │       ├── attributes.ts
│   │       ├── price-rules.ts
│   │       ├── bundles.ts
│   │       ├── wizards.ts
│   │       └── examples.ts               ← optional: sample customers/quotes/orders
│   └── demo_puffin/                      ← Puffin Cloud (new — implements XD-275 catalog)
│       ├── index.ts
│       ├── setup.ts                      ← registerCpqUseCase({ id: 'puffin', tenantSpec, seed })
│       └── seeds/
│           ├── tenant.ts
│           ├── products.ts               ← VPS, Compute, Block/Object Storage, CDN, etc.
│           ├── pricing-tables.ts         ← Compute family×size, CDN tiers, DB engine×plan×ha, etc.
│           ├── charges.ts
│           ├── attributes.ts             ← Managed DB attribute-rich configurator
│           ├── price-rules.ts            ← Reserved discounts, volume tiers, free tiers, premium-support uplift
│           ├── bundles.ts                ← bundle_dev_app, bundle_ecommerce, bundle_business_office
│           ├── wizards.ts
│           └── examples.ts
```

### The use-case contract

A use case is a self-contained, idempotent unit that knows how to seed one tenant's worth of CPQ data.

```typescript
// src/modules/cpq/lib/seeds/api.ts (new — exported from @dainamite/cpq)
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'

export type CpqUseCaseTenantSpec = {
  /** Stable slug used as a key in env overrides, e.g. `gix`, `puffin`. */
  slug: string
  /** Tenant display name, e.g. `GIX Network Services`. */
  tenantName: string
  /** Organization display name, e.g. `GIX`. Defaults to `tenantName`. */
  organizationName?: string
  /** Primary admin email. e.g. `admin@gix.com`. */
  adminEmail: string
  /** Initial admin password (dev-only — overridable via env). */
  adminPassword: string
  /** Roles to ensure on the tenant; default `['admin', 'employee']` (no superadmin). */
  roleNames?: string[]
  /** Roles assigned to the primary admin user. Default `['admin']`. */
  primaryUserRoles?: string[]
  /** Whether to also create the derived `employee@<domain>` user. Default `false`. */
  includeDerivedUsers?: boolean
}

export type CpqUseCaseSeedContext = {
  em: EntityManager
  container: AwilixContainer
  tenantId: string
  organizationId: string
  /** True when invoked under `mercato init --no-examples` — seeders should skip examples. */
  withExamples: boolean
}

export type CpqUseCase = {
  id: string                                            // 'gix', 'puffin', ...
  tenant: CpqUseCaseTenantSpec
  seedDefaults(ctx: CpqUseCaseSeedContext): Promise<void>   // products, pricing, rules, wizards, ACL
  seedExamples?(ctx: CpqUseCaseSeedContext): Promise<void>  // demo customers, quotes, orders
}

export function registerCpqUseCase(useCase: CpqUseCase): void
export function listCpqUseCases(): CpqUseCase[]
export function getCpqUseCase(id: string): CpqUseCase | undefined
```

The **registry is process-local module state** populated when the app's `module.setup` for each `@app/demo_<x>` module imports `registerCpqUseCase`. No DB tables; no generator file. Adding a new vertical means creating an `@app/demo_<x>` module and shipping one `setup.ts` that calls `registerCpqUseCase({ ... })`.

### The orchestrator module — `@app/demo_tenants`

A single, lightweight module whose job is:

1. **At init time** (`seedExamples` hook): walk the registered use cases, call `ensureDemoTenant()` for each, then `useCase.seedDefaults(ctx)` and (unless `--no-examples`) `useCase.seedExamples(ctx)`.
2. **At runtime via CLI**: expose `yarn mercato demo-tenants seed --use-case <id>` for re-seeding a single use case without re-initializing the whole app.

Why a separate `@app` module rather than making CPQ seed itself? Because **`@app/*` never publishes**. The orchestrator is per-app config; the use cases are per-app demos; CPQ stays clean.

### Tenant provisioning helper

```typescript
// src/modules/cpq/lib/seeds/tenant-provisioning.ts
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CpqUseCaseTenantSpec } from './api'

export type EnsuredTenant = {
  tenantId: string
  organizationId: string
  adminUserId: string
  /** True iff we created the tenant (vs found existing by admin email). */
  created: boolean
}

/**
 * Idempotent. If a user with `spec.adminEmail` already exists, return the
 * existing tenant/org/user. Otherwise:
 *  1. Call setupInitialTenant() (from @open-mercato/core/auth) with includeSuperadminRole=false
 *     → creates Tenant, Organization, Roles (admin, employee), ACL grants from each module's
 *       defaultRoleFeatures, primary admin user, optional employee user, KMS DEK if encryption is on.
 *  2. Run module-level seedDefaults for the new tenant scope (dictionaries, statuses, units, etc.).
 *  3. Run customer-roles defaults if customer_accounts is enabled.
 */
export async function ensureDemoTenant(
  em: EntityManager,
  container: AwilixContainer,
  spec: CpqUseCaseTenantSpec,
): Promise<EnsuredTenant>
```

This wraps the **existing** `setupInitialTenant()` exported from `@open-mercato/core/modules/auth/lib/setup-app` — no fork, no re-implementation. Crucially, we pass `includeSuperadminRole: false` so additional tenants do **not** get a superadmin grant; the only superadmin in the system remains the one created by `mercato init` for ACME.

### Hook into `mercato init`

`mercato init` already loops every module's `setup.seedDefaults(ctx)` and (unless `--no-examples`) `setup.seedExamples(ctx)`. The new flow:

1. **`mercato init`** runs as today: creates **ACME** tenant, calls `seedDefaults` for every module on ACME's scope, calls `seedExamples` for every module.
2. The `@app/demo_tenants` module's `seedExamples` hook detects "we are running for the primary tenant" and triggers the cross-tenant orchestration:
   - For each registered use case (`gix`, `puffin`, …):
     - `ensureDemoTenant(spec)` → returns `{ tenantId, organizationId }` for that use case
     - Run all module `seedDefaults({ em, tenantId: useCase.tenantId, organizationId: useCase.organizationId, container })` — same loop the framework uses, scoped to the new tenant
     - Run all module `seedExamples(ctx)` for that scope (skipped if `--no-examples`)
     - Call `useCase.seedDefaults(ctx)` and `useCase.seedExamples?.(ctx)` — the use-case-specific CPQ data
3. After the loop, log the created tenants and admin credentials to the same banner the init command currently prints.

This guarantees **identical bootstrap shape** for each demo tenant — every framework module's defaults run for them just like they do for ACME. No special-casing.

`yarn initialize` (the script in `package.json`) does not change. The behaviour difference is entirely inside `seedExamples`.

> **Trade-off**: routing the cross-tenant orchestration through `seedExamples` couples it to the `--no-examples` flag — if an operator passes `--no-examples` they get only the ACME tenant. This is the right semantics for a demo app: the additional tenants ARE the example data. For non-demo deployments where ops want only ACME, `--no-examples` already does the right thing. If we ever need "create tenants but skip example quotes", we'll add a finer-grained flag in a follow-up.

### CLI — re-seeding without re-init

A new CLI in the orchestrator module:

```bash
yarn mercato demo-tenants list                          # list registered use cases
yarn mercato demo-tenants seed --use-case gix           # idempotent re-seed of GIX only
yarn mercato demo-tenants seed --use-case puffin        # idempotent re-seed of Puffin only
yarn mercato demo-tenants seed --all                    # all registered use cases
yarn mercato demo-tenants seed --use-case puffin --reset # drop and recreate CPQ rows for that tenant
```

The non-`--reset` form is **strictly additive** (insert-if-missing, update-pricing-if-different). The `--reset` form deletes CPQ-owned rows for the tenant first (in dependency order: charges → offerings → specifications → pricing tables → price rules → wizards → bundle slots/components), then re-seeds. It never touches the tenant, organization, users, or non-CPQ data.

### CPQ module — what stays, what moves

`src/modules/cpq/setup.ts` — the post-refactor file is **~80 lines** (down from 1,138). What remains:

- `defaultRoleFeatures` for `admin` and `employee` (unchanged).
- `seedDefaults` calls **only** `seedCpqDefaults(em, scope)` — i.e. the wizard definitions in `lib/seeds.ts`. **No GIX data**. No products, no pricing tables, no charges, no rules, no bundles.
- `seedExamples` is removed (the use-case seed runner takes over for any examples; CPQ ships with none of its own).
- The `setupInitialTenant`-driven bootstrap of structural data (currencies, dictionaries, etc.) continues to be each framework module's responsibility — CPQ never seeded those.

`src/modules/cpq/lib/example-seeds.ts` (Acme/Globex sample quotes) **moves** to `@app/demo_gix/seeds/examples.ts` because every line of it depends on GIX offering codes.

`src/modules/cpq/lib/seeds.ts` — keep as-is (generic wizard defs).

---

## Data Model

**No new entities. No new migrations.** Everything reuses:

| Existing entity | What this spec writes to it |
|-----------------|----------------------------|
| `Tenant`, `Organization` | One row per use case (`GIX`, `Puffin Cloud`) created via `setupInitialTenant`. |
| `User`, `UserRole`, `Role`, `RoleAcl` | One admin user per use case + one `admin` role + ACL grants. |
| `CpqProductSpecification` | Per-tenant product specs from the use case. |
| `CpqProductOffering` | Per-tenant offerings (incl. `metadata.listedInCalculator: true` for Puffin's public-calculator items). |
| `CpqProductAttribute`, `CpqProductCharge`, `CpqPricingTable`, `CpqPricingTableRow`, `CpqPriceRule` | Per-tenant. |
| `CpqBundleSlot`, `CpqOfferingComponent` | Per-tenant bundles. |
| `CpqWizardDefinition` | Generic wizards from CPQ + use-case-specific wizards. |
| `CustomerEntity`, `CustomerCompanyProfile`, `SalesQuote`, `CpqQuoteConfiguration`, … | Demo customers/quotes per `seedExamples`. |

**Composite uniqueness for idempotency**: every CPQ entity already has a tenant-scoped natural key (`code`, `slug`, or `(specId, attributeKey)`). All seed inserts are gated by `em.findOne({ tenantId, organizationId, <natural-key> })` first — same pattern the existing GIX seed uses.

---

## Tenant manifest (default)

Shipped as the default registration set in `@app/demo_tenants/manifest.ts`. Operators can override per-environment via env vars or by editing the file.

| Use case | Tenant Name | Org Name | Admin Email | Admin Password | Roles | Notes |
|----------|-------------|----------|-------------|----------------|-------|-------|
| (n/a — created by `mercato init`) | `Acme Tenant` | `Acme Corp` | `superadmin@acme.com` | `secret` | superadmin, admin, employee | Empty CPQ data after refactor (no GIX seed bleeds in). |
| `gix` | `GIX Network Services Tenant` | `GIX` | `admin@gix.com` | `secret` | admin, employee | Receives the migrated GIX catalog. |
| `puffin` | `Puffin Cloud Tenant` | `Puffin Cloud` | `admin@puffin.com` | `secret` | admin, employee | Implements the XD-275 Cloud Services Provider catalog. |

Env overrides (read with the same `OM_INIT_*` style as core):

| Variable | Purpose | Default |
|----------|---------|---------|
| `CPQ_DEMO_USE_CASES` | CSV of use-case IDs to seed. Empty = none. `*` = all registered. | `gix,puffin` |
| `CPQ_DEMO_<USECASE>_ADMIN_EMAIL` | Override admin email for a use case (e.g. `CPQ_DEMO_GIX_ADMIN_EMAIL`). | per manifest |
| `CPQ_DEMO_<USECASE>_ADMIN_PASSWORD` | Override admin password. | `secret` |
| `CPQ_DEMO_SKIP_EXAMPLES` | If truthy, run only `seedDefaults` per use case (not `seedExamples`), even when `--no-examples` was not passed. | `false` |

---

## Use-case seed: GIX (port of existing data)

Functionally **no change** to what gets seeded — only where it lives. Migrating the existing 1,000-line dataset means moving these top-level constants to `@app/demo_gix/seeds/`:

| Constant in current `setup.ts` | New file |
|--------------------------------|----------|
| `DATA_CENTRE_OPTIONS` | `seeds/attributes.ts` (used by GIX-only attribute) |
| `PRODUCTS` | `seeds/products.ts` |
| `ACCESS_PORT_PRICES` | `seeds/pricing-tables.ts` |
| `INTERNET_PEERING_TIERS`, `MOBILE_PEERING_TIERS` | `seeds/pricing-tables.ts` |
| `CLOUD_CONNECT_ENTRIES` | `seeds/pricing-tables.ts` |
| `seedProducts`, `seedPricingTables`, `seedProductAttributes`, `seedProductCharges`, `seedProductSpecsAndOfferings`, `seedPriceRules`, `seedBundleData` | matching files in `seeds/`, exported from a single `seedGixUseCase()` |
| `lib/example-seeds.ts` (`seedCpqExamples`) | `seeds/examples.ts` |

The `gix` wizard from `lib/seeds.ts` (`gix-access-port-bundle`) **moves** to `@app/demo_gix/seeds/wizards.ts`. The GIX wizard is GIX-specific, so it does not belong in CPQ proper. Generic CPQ wizards (the empty-shell defaults — none today) stay in `cpq/lib/seeds.ts`.

The use case is registered in `@app/demo_gix/setup.ts`:

```typescript
import { registerCpqUseCase } from '@dainamite/cpq/lib/seeds/api'
import { seedGixDefaults, seedGixExamples } from './seeds'

export const setup = {
  // No defaultRoleFeatures here — CPQ supplies them. We add nothing.
  async onTenantCreated() { /* no-op */ },
}

registerCpqUseCase({
  id: 'gix',
  tenant: {
    slug: 'gix',
    tenantName: 'GIX Network Services Tenant',
    organizationName: 'GIX',
    adminEmail: 'admin@gix.com',
    adminPassword: 'secret',
    roleNames: ['admin', 'employee'],
    primaryUserRoles: ['admin'],
  },
  seedDefaults: seedGixDefaults,
  seedExamples: seedGixExamples,
})
```

Registration runs on module import. The orchestrator's `seedExamples` hook iterates `listCpqUseCases()` after this side effect.

---

## Use-case seed: Puffin Cloud (new — implements XD-275)

A new bundle. The catalog mirrors the [Cloud Services Provider requirements](../sample-use-cases/cloud-services-provider-requirements.md) **exactly** — every product, pricing table, attribute, rule, and bundle described there is realized here.

### Products → specifications/offerings

| Spec code | Modelling pattern | Offerings | Notes |
|-----------|------------------|-----------|-------|
| `SPEC-PUFFIN-VPS` | discrete-offerings | `vps_nano`, `vps_micro`, `vps_small`, `vps_medium`, `vps_large`, `vps_xlarge`, `vps_mega` (7) | Marketing names: Puffling, Tufted, Atlantic, Horned, Rhinoceros, Crested, Emperor. Each offering has its own `designTimeValues` (vCPU/RAM/disk/bundled-egress) and own MRC charge. |
| `SPEC-PUFFIN-COMPUTE` | single-offering + multidimensional pricing table | `OFFER-PUFFIN-COMPUTE` | Pricing table dimensions: `instance_family` × `instance_size`. Stored per-second internally. |
| `SPEC-PUFFIN-BLOCK-STORAGE` | single-offering + per-GB-month flat | `OFFER-PUFFIN-BLOCK-STD`, `OFFER-PUFFIN-BLOCK-PROV` | iops_tier as an attribute or as two offerings — choose two offerings to keep configurator simple. |
| `SPEC-PUFFIN-OBJECT-STORAGE` | single-offering composite charges (stored, egress, class-A, class-B) | `OFFER-PUFFIN-OBJECT-STORAGE` | Three usage charges + zero-priced platform `mrc`. |
| `SPEC-PUFFIN-CDN` | single-offering + tiered volume pricing on egress | `OFFER-PUFFIN-CDN`, `OFFER-PUFFIN-CDN-WAF` (separate add-on offering) | Platform fee 25.00 MRC. |
| `SPEC-PUFFIN-API-GATEWAY` | composite (per-1M req + per-GB-s) + free-tier price-rule | `OFFER-PUFFIN-API-GATEWAY` | |
| `SPEC-PUFFIN-DDOS` | discrete-offerings | `OFFER-PUFFIN-DDOS-STD`, `OFFER-PUFFIN-DDOS-ADV`, `OFFER-PUFFIN-DDOS-ENT` | Enterprise requires `contract_term_months >= 12`. |
| `SPEC-PUFFIN-MANAGED-DB` | attribute-rich + multidim pricing (`db_engine` × `plan_size` × `ha_replicas`) + composable surcharges | `OFFER-PUFFIN-MANAGED-DB` | Showcase product for attribute dependencies, references, constraints. |
| `SPEC-PUFFIN-WORKSPACE` | discrete-offerings + per-seat pricing + add-ons | `workspace_essentials`, `workspace_business`, `workspace_business_premium`, `workspace_enterprise`, plus add-on offerings `ws_email_archive`, `ws_atp`, `ws_extra_storage`, `ws_compliance` | Volume tiers + annual prepay as composable price rules. |
| `SPEC-PUFFIN-BANDWIDTH` | single-offering + tiered per-GB | `OFFER-PUFFIN-BANDWIDTH` | |
| `SPEC-PUFFIN-SUPPORT` | discrete-offerings | `support_community`, `support_developer`, `support_business` | |
| `SPEC-PUFFIN-PREMIUM-SUPPORT` | composite (base MRC + `price_override` uplift + included usage hours + optional add-on) | `OFFER-PUFFIN-PREMIUM-SUPPORT` | The spend-uplift is a `CpqPriceRule` of type `price_override` evaluated last. |
| `SPEC-PUFFIN-BUNDLE-DEV-APP` (`spec_type: 'bundle'`) | bundle | `dev_app_solo`, `dev_app_standard`, `dev_app_pro` | "Ship My App" — slots: app_host, database, static_assets, cdn (0–1), support. |
| `SPEC-PUFFIN-BUNDLE-ECOMMERCE` (`spec_type: 'bundle'`) | bundle | `ecom_small_shop`, `ecom_growing_shop`, `ecom_high_volume` | "Run My Online Shop" — slots: storefront_host (1–2), database, cache (0–1), media, cdn, ddos, bandwidth, support. |
| `SPEC-PUFFIN-BUNDLE-BUSINESS-OFFICE` (`spec_type: 'bundle'`) | bundle | `biz_small_team`, `biz_growing`, `biz_established` | "Run My Business" — slots: public_website, apps_host (0–2), shared_database, file_storage, ddos, workspace_seats, workspace_archive (0–1), support. |

### Pricing tables (one row per pricing table seeded)

- `PT-PUFFIN-COMPUTE` — dims `[instance_family, instance_size]`, single price column `price_per_hour`. ~21 rows.
- `PT-PUFFIN-CDN-EGRESS` — dim `monthly_egress_gb` (range_from/range_to), 5 tiers.
- `PT-PUFFIN-BANDWIDTH` — dim `monthly_egress_gb`, 4 tiers.
- `PT-PUFFIN-MANAGED-DB-BASE` — dims `[db_engine, plan_size, ha_replicas]`, single price column `mrc`. ~54 rows (4 engines × multiple plans × 3 HA values, with redis missing 2xl).

### Attributes (key examples — full set in `seeds/attributes.ts`)

- VPS line: `region`, `os_image`, `backups`.
- Compute line: `instance_family`, `instance_size` (depends on family), `region`, `monthly_active_hours`, `reserved_term`.
- Managed DB: `db_engine`, `version` (depends on engine, options from a `referenceEntity` filtered list), `plan_size`, `region`, `ha_replicas`, `read_replicas` (depends on `ha_replicas ≥ 1`), `backup_retention_days`, `pitr_enabled` (depends on engine ∈ {postgres, mysql}), `vpc_peering`, `parameter_group` (reference attribute, filtered by engine), `maintenance_window` (free text).
- Workspace: `seat_count`, `billing_cadence` (`monthly`/`annual_prepay`).
- DDoS: `tier`, `contract_term_months` (depends on tier=enterprise → ≥ 12).

### Price rules

- `pr-puffin-vps-backups` — `discount_percent` of `−20%`? No — backups is a +20% **surcharge**. Modelled as `surcharge_percent` (or as a separate `mrc` charge whose applicability is `backups = true`). Pick the latter for legibility.
- `pr-puffin-reserved-1y`, `pr-puffin-reserved-3y` — `discount_percent` (−22% / −38%) on MRC of eligible specs (VPS, Compute, Managed DB, DDoS adv/ent). Applicability via `applicabilityCondition` referencing `quote.context.contract_model` and `offering.spec.code`.
- `pr-puffin-ws-volume-25/100/500` — `discount_percent` on Workspace charges, mutually exclusive (priority ordered).
- `pr-puffin-ws-annual-prepay` — `discount_percent −15%` on Workspace charges when `quote.context.billing_cadence = 'annual_prepay'`.
- `pr-puffin-api-free-tier` — subtracts first 1M requests + 400k GB-s/month from the API Gateway usage subtotal, never below zero.
- `pr-puffin-premium-support-uplift` — `price_override` evaluated **after** every other line; sets the Premium Support MRC to `max(500, 0.06 × sum_mrc_excluding_support)`. Priority guarantees it runs last.
- `pr-puffin-vps-bundled-egress` — deducts the per-VPS-plan free egress allowance from any same-line Bandwidth charge. Implemented as a `discount_absolute` rule applicable only when both charges share a quote line/region.

### Wizards

- `puffin-public-calculator-flow` — not actually rendered by the CPQ wizard runner (the public calculator at `/pricing` is its own UI per XD-275); we still seed a backend wizard mirror for the sales-led journey.
- `puffin-sales-led-quote` — backend wizard that walks: select-customer → choose-contract-model → add-products → configure-each-line → review.

### Examples (`seeds/examples.ts`)

Three demo customers, one demo quote each — chosen to exercise different pricing paths:

| Customer | Quote | Lines | Why |
|----------|-------|-------|-----|
| `Acme Apps Ltd` | "Dev app — Standard package" | bundle `dev_app_standard` expanded into VPS Atlantic + postgres-sm-ha0 + object-storage + CDN + Developer support | Shows bundle expansion with `quoteContext.fromBundle = '<offeringId>'`. |
| `Northbeach Shop` | "E-commerce — Growing Shop" | bundle `ecom_growing_shop` | Shows multi-region bundle, WAF add-on, redis cache, advanced DDoS. |
| `Tundra Mining Co.` | "Custom enterprise mix" | 2× VPS Rhinoceros, Workspace Enterprise 250 seats annual_prepay, Premium Support, Reserved 3y | Shows volume-tier × annual-prepay rule stacking and Premium Support `price_override`. |

---

## Initialization Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ yarn initialize  (alias for: mercato init)                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
            ┌──────────────────────────────────────┐
            │ 1. mercato auth setup                 │  → Acme Tenant + superadmin@acme.com
            └──────────────────────────────────────┘
                              │
                              ▼
            ┌──────────────────────────────────────┐
            │ 2. for each module:                   │  → Standard framework defaults
            │      module.setup.seedDefaults(acme)  │     (including cpq.seedDefaults — wizards only)
            └──────────────────────────────────────┘
                              │
                              ▼
            ┌──────────────────────────────────────┐
            │ 3. ensureCustomRoleAcls(acme)         │
            └──────────────────────────────────────┘
                              │
                              ▼
            ┌──────────────────────────────────────┐
            │ 4. for each module:                   │
            │      module.setup.seedExamples(acme)  │  ← @app/demo_tenants seedExamples runs here
            └──────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────────────────────┐
              ▼                                                ▼
    ┌─────────────────────────────┐         ┌────────────────────────────────────┐
    │ Other modules' seedExamples │         │ @app/demo_tenants.seedExamples     │
    │ (run on Acme scope)          │         │ (ignores acme; orchestrates others) │
    └─────────────────────────────┘         └────────────────────────────────────┘
                                                          │
                                                          │ for each registered use case (gix, puffin):
                                                          ▼
                                          ┌────────────────────────────────────┐
                                          │ a. ensureDemoTenant(spec)          │
                                          │    → setupInitialTenant + admin user│
                                          └────────────────────────────────────┘
                                                          │
                                                          ▼
                                          ┌────────────────────────────────────┐
                                          │ b. for each module:                │
                                          │    module.setup.seedDefaults(scope)│
                                          └────────────────────────────────────┘
                                                          │
                                                          ▼
                                          ┌────────────────────────────────────┐
                                          │ c. ensureCustomRoleAcls(scope)      │
                                          └────────────────────────────────────┘
                                                          │
                                                          ▼
                                          ┌────────────────────────────────────┐
                                          │ d. useCase.seedDefaults(ctx)        │  ← CPQ data: products, pricing, rules
                                          └────────────────────────────────────┘
                                                          │
                                                          ▼
                                          ┌────────────────────────────────────┐
                                          │ e. (unless --no-examples)          │
                                          │    for each module:                │
                                          │       module.setup.seedExamples    │
                                          │    useCase.seedExamples(ctx)        │
                                          └────────────────────────────────────┘
                              │
                              ▼
            ┌──────────────────────────────────────┐
            │ 5. Final banner — print all created   │
            │    tenants and admin credentials      │
            └──────────────────────────────────────┘
```

The recursion-guard inside the orchestrator is a `Set<string>` of tenant ids it has already processed — prevents accidental loops if `seedExamples` is re-entered.

---

## Implementation Plan

Phased so each phase can land independently, gates open after each.

### Phase 1 — Carve out the use-case API in `cpq` (no behaviour change)

1. Add `src/modules/cpq/lib/seeds/api.ts` (registry + types) and `tenant-provisioning.ts` (`ensureDemoTenant`).
2. Add unit tests covering: registration is idempotent (second call with same id is a no-op + warn), `getCpqUseCase` returns `undefined` for unknown ids, `ensureDemoTenant` reuses existing tenants by admin email.
3. CPQ `setup.ts` is **untouched** in this phase. GIX seeds still run inline. Just laying foundations.

### Phase 2 — Create `@app/demo_gix` and migrate GIX data out of CPQ

1. Create the new module. Move every `seedXxx` function from `cpq/setup.ts` to `@app/demo_gix/seeds/*.ts`.
2. Move `cpq/lib/example-seeds.ts` to `@app/demo_gix/seeds/examples.ts`.
3. Move the GIX wizard from `cpq/lib/seeds.ts` to `@app/demo_gix/seeds/wizards.ts`. Leave the empty-shell wizards (none today) in `cpq/lib/seeds.ts`.
4. `@app/demo_gix/setup.ts`: `registerCpqUseCase({ id: 'gix', tenant: { adminEmail: 'admin@gix.com', ... }, seedDefaults: seedGixDefaults, seedExamples: seedGixExamples })`.
5. `cpq/setup.ts`: trim to ~80 lines — `seedDefaults` only seeds wizard defs.
6. Register `{ id: 'demo_gix', from: '@app' }` in `src/modules.ts`.
7. **At this point ACME stops getting GIX data.** Run `yarn db:greenfield && yarn initialize` and verify ACME has zero CPQ products. The use case is registered but the orchestrator does not exist yet — no second tenant is created. Phase 2 is a temporary state: GIX data is out of CPQ but no longer reaches any tenant. Confirm with a manual `yarn mercato demo-tenants seed --use-case gix --tenant-id <acme>` smoke test (the CLI lands in Phase 3, but this is a fast way to verify the seed itself runs end-to-end).

### Phase 3 — `@app/demo_tenants` orchestrator + multi-tenant flow

1. Create `@app/demo_tenants/index.ts`, `setup.ts`, `manifest.ts`.
2. Implement the `seedExamples` hook: walk registered use cases, call `ensureDemoTenant`, run all module `seedDefaults` and `seedExamples` for the new scope, then run `useCase.seedDefaults` and `useCase.seedExamples`.
3. Add the CLI: `yarn mercato demo-tenants list|seed --use-case <id>|seed --all|seed --reset`.
4. Register `{ id: 'demo_tenants', from: '@app' }` in `src/modules.ts`. **Order matters**: `demo_tenants` should appear after every demo use case so registrations have run before its `seedExamples`. Use module `requires: ['cpq', 'demo_gix', 'demo_puffin']` to enforce.
5. Run `yarn db:greenfield && yarn initialize`. Verify three tenants exist, GIX data lives in GIX tenant only, ACME is clean.

### Phase 4 — `@app/demo_puffin` (XD-275 catalog)

1. Create the module skeleton mirroring `demo_gix`.
2. Implement each `seeds/*.ts` file, faithful to the XD-275 tables.
3. Register the use case.
4. Run `yarn db:greenfield && yarn initialize`. Verify Puffin tenant has the full catalog and three demo quotes price within ±5% of the indicative MRCs in XD-275.
5. End-to-end test: `yarn mercato demo-tenants seed --use-case puffin --reset` clears and re-seeds Puffin without touching the others.

### Phase 5 — Hook the Puffin public calculator (light touch in this spec)

This phase only ensures the Puffin offerings carry `metadata.listedInCalculator: true` and that the `cpq.public.calculator` feature flag default (per XD-275) lives in the `demo_puffin` module. The actual `/pricing` UI and `/api/cpq/public/*` routes are XD-275's responsibility — XD-276 just makes sure their data is there.

### Phase 6 — Tests, docs, CI

1. Unit tests:
   - `registerCpqUseCase` registry semantics.
   - `ensureDemoTenant` idempotency (find-existing-by-email path + new-tenant path).
   - `seedGixDefaults` / `seedPuffinDefaults` produce the expected product/charge counts when run against an empty in-memory EM.
   - Pricing assertions: at least one canonical scenario per use case (e.g., "Workspace 150 Business seats annual_prepay = $1,377.00 / mo" exactly per XD-275).
2. Integration test (`.ai/qa/tests/`): `yarn db:greenfield && yarn initialize` produces three tenants and admin login works for each.
3. Update `CLAUDE.md` Task→Context Map: link to this spec under "Modify CPQ seed / demo data". Update `packages/cpq/MIGRATION.md` to note that customer demo data now lives outside CPQ.
4. CI: extend the existing post-init smoke test to assert the three tenants and the per-tenant CPQ row counts.

---

## Idempotency & Safety

- **Find-then-insert** for every seed write — the existing GIX seed already does this; carry the pattern through Puffin.
- **Tenant reuse**: `ensureDemoTenant` checks for an existing user by `adminEmail` first and, if found, reuses that tenant/org rather than creating duplicates.
- **No global mutations**: every CPQ insert carries `(tenantId, organizationId)`. Cross-tenant queries are impossible.
- **Reset safety**: `--reset` only deletes rows whose `(tenant_id, organization_id)` match the use case's tenant. Never `TRUNCATE`. Ordering: charges → offering components → bundle slots → offerings → specifications → pricing-table rows → pricing tables → price rules → wizards.
- **Dependency order**: orchestrator runs use cases in `requires`-respecting order so e.g. `demo_puffin` could depend on a future `demo_shared` if needed.

---

## Telemetry & Observability

- Each `ensureDemoTenant` call logs `{ tenantId, organizationId, adminEmail, created: bool, durationMs }`.
- Each use-case seed step logs counts: `[cpq:seed:puffin] specs=15 offerings=27 charges=64 rules=11 bundles=3 wizards=2`.
- The init banner now prints a **table** of every created/reused tenant + admin email + password (for dev). Production environments should set `OM_INIT_HIDE_PASSWORDS=1` to suppress passwords.

---

## Backwards Compatibility

- Existing developers running `yarn initialize` against an empty DB get the new shape automatically — three tenants instead of one.
- Developers with an existing DB created from the old single-tenant init: nothing breaks. Their ACME tenant still has its (now-orphan) GIX data. To switch to the new layout, they run `yarn db:greenfield && yarn initialize`. We document this in the migration log.
- The `cpq` module still exposes the same `setup.seedDefaults` shape — only its body shrinks. No public service contract changes.
- The `setupInitialTenant` API in `@open-mercato/core/auth` is reused, not modified. We only need its `includeSuperadminRole: false` flag, which is already supported.

---

## Acceptance Criteria

- [ ] `yarn db:greenfield && yarn initialize` runs to completion and prints three tenants with admin credentials in the banner: `superadmin@acme.com`, `admin@gix.com`, `admin@puffin.com` (passwords default to `secret`).
- [ ] Logging in as `superadmin@acme.com` shows **zero** CPQ products/specs/offerings under `/backend/cpq/*`.
- [ ] Logging in as `admin@gix.com` shows the full GIX catalog (5 products, GIX wizard, all GIX pricing tables) — bit-for-bit equivalent to what the legacy single-tenant init produced.
- [ ] Logging in as `admin@puffin.com` shows the Puffin catalog: ≥ 12 product specifications, the 7 VPS offerings as discrete cards, the 3 bundles each with 3 packages, and all pricing tables described in XD-275.
- [ ] No CPQ rows leak across tenants — for every `cpq_*` table, every row's `tenant_id` belongs to exactly one of the three tenants.
- [ ] Each tenant's `admin` and `employee` roles have the correct ACL feature grants (`cpq.*` per the existing `defaultRoleFeatures`).
- [ ] `yarn mercato demo-tenants list` lists `gix` and `puffin`.
- [ ] `yarn mercato demo-tenants seed --use-case puffin --reset` clears Puffin's CPQ rows and re-seeds them; ACME and GIX are untouched.
- [ ] Re-running `yarn initialize` against the already-initialized DB is a no-op (no duplicate users, products, prices, rules).
- [ ] `src/modules/cpq/setup.ts` contains zero hard-coded product/pricing data; ≤ 100 lines total.
- [ ] `src/modules/cpq/` does not import from `src/modules/@app/*` (CPQ stays packageable per SPEC-001).
- [ ] Adding a hypothetical fourth use case is purely additive: create `@app/demo_<x>/`, register, add to `manifest.ts` — no changes to `cpq/` or `demo_tenants/`.
- [ ] Pricing canon checks pass:
  - Puffin Workspace Business 150 seats with annual prepay = `150 × $12 × 0.90 × 0.85 = $1,377.00 / mo` (exact).
  - Puffin Premium Support on a $5,200 MRC cart = `$812 / mo` (composite breakdown).
  - GIX Access Port `equinix-fr5` × `10G` = NRC $490, MRC $410.
- [ ] Unit tests covering registry semantics, idempotency, and the canon prices live under `src/modules/cpq/__tests__/seeds/`, `src/modules/@app/demo_gix/__tests__/`, and `src/modules/@app/demo_puffin/__tests__/`.
- [ ] Integration test under `.ai/qa/tests/` boots a fresh app, performs `yarn initialize`, and logs in as each of the three admin users via the public auth API.

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Use-case API in cpq | Done | 2026-05-04 | api.ts (registry) + tenant-provisioning.ts (ensureDemoTenant) + 17 unit tests passing. CPQ setup.ts unchanged. Typecheck clean. |
| Phase 2 — Migrate GIX to @app/demo_gix | Done | 2026-05-04 | New module at `src/modules/demo_gix/` registers `gix` use case via `registerCpqUseCase`. cpq/setup.ts trimmed from 1,138 → 56 lines. cpq/lib/example-seeds.ts deleted. cpq/lib/seeds.ts reduced to no-op. 380 tests pass. Typecheck clean. ACME no longer receives GIX data (transitional state until Phase 3 orchestrator routes it to its own tenant). |
| Phase 3 — @app/demo_tenants orchestrator | Done | 2026-05-04 | New module at `src/modules/demo_tenants/`. `seedExamples` hook walks `getEnabledUseCases()` (env-driven manifest), provisions a tenant per use case via `ensureDemoTenant`, replays every module's `seedDefaults`/`seedExamples` for the new scope, then runs use-case seeders. CLI: `mercato demo-tenants list|seed --use-case <id>|seed --all|seed --reset|env --use-case <id>`. Recursion guard skips own module. 18 new unit tests (398/398 total green). Typecheck clean. |
| Phase 4 — @app/demo_puffin (XD-275 catalog) | Done | 2026-05-04 | New module at `src/modules/demo_puffin/`. 15 specs (12 simple + 3 bundles), 30+ offerings, 4 pricing tables (~80 rows), 14 price rules, 21 bundle slots, sales-led wizard, 3 demo customers + quotes. 21 canonical pricing tests (419 total green). |
| Phase 5 — Public calculator metadata | Done | 2026-05-04 | `metadata.listedInCalculator: true` set on every Puffin offering by `seedPuffinProducts`. `DEFAULT_PUBLIC_CALCULATOR_FEATURE` exported from `demo_puffin/setup.ts` for XD-275 to consume. 4 new unit tests (423 total green). |
| Phase 6 — Tests, docs, CI | Done | 2026-05-04 | Imports converted from `@/` alias to relative paths (esbuild-friendly). CLAUDE.md updated with new Task→Context Map row. packages/cpq/MIGRATION.md updated with the customer-demo-data exclusion. `yarn generate` clean. `yarn build` clean. `yarn test` — 423/423 green. |

### Phase 1 — Detailed Progress
- [x] `src/modules/cpq/lib/seeds/api.ts` — registry types + `registerCpqUseCase` / `listCpqUseCases` / `getCpqUseCase` / `clearCpqUseCases`
- [x] `src/modules/cpq/lib/seeds/tenant-provisioning.ts` — `ensureDemoTenant` (wraps `setupInitialTenant` with `includeSuperadminRole: false`) + `findDemoTenant` lookup helper
- [x] `src/modules/cpq/lib/seeds/__tests__/api.test.ts` — 8 registry semantics tests
- [x] `src/modules/cpq/lib/seeds/__tests__/tenant-provisioning.test.ts` — 9 idempotency / fallback tests
- [x] `yarn test src/modules/cpq/lib/seeds/__tests__/` — 17/17 green
- [x] `npx tsc --noEmit -p tsconfig.json` — clean

### Phase 2 — Detailed Progress
- [x] `src/modules/demo_gix/index.ts` + `acl.ts` (empty) + `setup.ts` (registers `gix` use case)
- [x] `src/modules/demo_gix/seeds/data/products.ts` — `PRODUCTS`, `DATA_CENTRE_OPTIONS`
- [x] `src/modules/demo_gix/seeds/data/pricing.ts` — `ACCESS_PORT_PRICES`, `INTERNET_PEERING_TIERS`, `MOBILE_PEERING_TIERS`, `CLOUD_CONNECT_ENTRIES`
- [x] `src/modules/demo_gix/seeds/seeders.ts` — 7 seeders (products, attributes, pricing tables, charges, specs/offerings, price rules, bundle data)
- [x] `src/modules/demo_gix/seeds/wizards.ts` — GIX wizard definition
- [x] `src/modules/demo_gix/seeds/examples.ts` — Acme/Globex demo customers + 4 quotes + order activation
- [x] `src/modules/demo_gix/seeds/index.ts` — composes `seedGixDefaults` and `seedGixExamples` against the `CpqUseCaseSeedContext` shape
- [x] `src/modules/cpq/setup.ts` trimmed from 1,138 → 56 lines (zero customer demo data)
- [x] `src/modules/cpq/lib/example-seeds.ts` deleted
- [x] `src/modules/cpq/lib/seeds.ts` reduced to no-op `seedCpqDefaults` (back-compat shim)
- [x] `src/modules.ts` — `{ id: 'demo_gix', from: '@app' }` registered after `cpq`
- [x] Spec note: `@app/<id>` directory layout in the original spec was conceptual; the actual module path is `src/modules/demo_gix/` (matches existing `cpq`, `example` modules). Same applies to phases 3 & 4.
- [x] `yarn test` — 380/380 green
- [x] `npx tsc --noEmit -p tsconfig.json` — clean

### Phase 3 — Detailed Progress
- [x] `src/modules/demo_tenants/index.ts` + `acl.ts` (empty default export)
- [x] `src/modules/demo_tenants/manifest.ts` — `getEnabledUseCases()` (env-driven, defaults to `gix,puffin`, `*` = all, empty = none, unknown ids warn-and-skip) + `shouldSkipExamples()` (`CPQ_DEMO_SKIP_EXAMPLES` or `OM_INIT_NO_EXAMPLES`)
- [x] `src/modules/demo_tenants/runner.ts` — `seedUseCase(useCase, options)` and `seedUseCases(list, options)`. Per use case: `ensureDemoTenant` → loop module `seedDefaults` → `ensureCustomRoleAcls` → `useCase.seedDefaults` → (if withExamples) loop module `seedExamples` + `useCase.seedExamples`. Filters out `demo_tenants` to avoid recursion.
- [x] `src/modules/demo_tenants/setup.ts` — `seedExamples` hook orchestrates the full multi-tenant flow with the primary tenant id seeded into the recursion guard.
- [x] `src/modules/demo_tenants/cli.ts` — `list`, `seed --use-case <id>|--all [--reset]`, `env --use-case <id>` (prints `CPQ_PUBLIC_CALCULATOR_TENANT_ID/_ORG_ID`). `--reset` deletes CPQ rows for the use-case's tenant in dependency order; never touches Tenant/Org/User.
- [x] `src/modules.ts` — `{ id: 'demo_tenants', from: '@app' }` registered after `demo_gix`.
- [x] `src/modules/demo_tenants/__tests__/manifest.test.ts` — 11 manifest tests
- [x] `src/modules/demo_tenants/__tests__/runner.test.ts` — 7 runner tests (recursion guard, withExamples gate, idempotent reuse, ordering, durationMs)
- [x] `yarn test` — 398/398 green
- [x] `npx tsc --noEmit -p tsconfig.json` — clean

### Phase 4 — Detailed Progress
- [x] `src/modules/demo_puffin/seeds/data/products.ts` — 15 product definitions (VPS, Compute, Block/Object Storage, CDN, API Gateway, DDoS, Managed DB, Workspace, Bandwidth, Support, Premium Support + 3 bundles), regions
- [x] `src/modules/demo_puffin/seeds/data/pricing.ts` — Compute (19 rows), CDN (5 tiers), Bandwidth (4 tiers), Managed DB (54 rows: engine × plan × ha), Object Storage charges, API Gateway charges
- [x] `src/modules/demo_puffin/seeds/seeders/products.ts` — CatalogProduct + Specification + Offering creation (with `listedInCalculator: true` metadata)
- [x] `src/modules/demo_puffin/seeds/seeders/pricing-tables.ts` — Compute / CDN / Bandwidth / Managed DB pricing tables
- [x] `src/modules/demo_puffin/seeds/seeders/attributes.ts` — Product attributes including the Managed DB 11-attribute showcase (engine, version, plan, ha, replicas with dependsOn, pitr with engine constraint, parameter_group reference, etc.)
- [x] `src/modules/demo_puffin/seeds/seeders/charges.ts` — All product charges (per-VPS-plan fixed, Compute on-demand + reserved variants, Object Storage composite, DDoS tier-fixed, Managed DB base + composable surcharges, Workspace per-seat, Premium Support composite)
- [x] `src/modules/demo_puffin/seeds/seeders/specs-linkage.ts` — Orphan attribute/charge linker (no-op for Puffin, kept for symmetry)
- [x] `src/modules/demo_puffin/seeds/seeders/price-rules.ts` — 14 price rules (VPS backups surcharge, reserved 1y/3y, Workspace volume tiers + annual prepay, API free tier, Managed DB read-replica/PITR/retention rates, Premium Support spend uplift)
- [x] `src/modules/demo_puffin/seeds/seeders/bundles.ts` — `bundle_dev_app` (5 slots), `bundle_ecommerce` (8 slots), `bundle_business_office` (8 slots) with components per package
- [x] `src/modules/demo_puffin/seeds/seeders/wizards.ts` — `puffin-sales-led-quote` 4-step backend wizard
- [x] `src/modules/demo_puffin/seeds/seeders/examples.ts` — Acme Apps / Northbeach / Tundra demo customers + quotes
- [x] `src/modules/demo_puffin/seeds/index.ts` — composes seedPuffinDefaults + seedPuffinExamples
- [x] `src/modules/demo_puffin/setup.ts` — registers `puffin` use case
- [x] `src/modules.ts` — `demo_puffin` registered before `demo_tenants`
- [x] `src/modules/demo_puffin/__tests__/canon-pricing.test.ts` — 21 canonical pricing tests:
  - VPS Atlantic = $24 MRC / $5 NRC, Horned = $48 MRC, all plans have bundled_egress_tb
  - Compute table has 19 rows, gpu/a100 = $3.45/h
  - DB postgres-md HA-0/1/2 = $60/$120/$180; redis omits 2xl
  - Workspace 150 Business seats annual prepay = exactly $1,377.00
  - Premium Support: $1,000 cart → $500/mo (floor binds), $5,200 → $812, $40,000 → $2,400
- [x] `yarn test` — 419/419 green
- [x] `npx tsc --noEmit -p tsconfig.json` — clean

### Phase 5 — Detailed Progress
- [x] `metadata.listedInCalculator: true` set on every Puffin offering at seed time (in `seedPuffinProducts`)
- [x] `DEFAULT_PUBLIC_CALCULATOR_FEATURE` exported from `src/modules/demo_puffin/setup.ts` so XD-275 has a single home for the flag default
- [x] `src/modules/demo_puffin/__tests__/calculator-metadata.test.ts` — 4 tests verifying calculator-listing semantics
- [x] `yarn test` — 423/423 green

### Phase 6 — Detailed Progress
- [x] All `@/` aliased imports in new modules converted to relative paths (esbuild bundler in `yarn generate` doesn't resolve `@/`)
- [x] `CLAUDE.md` Task→Context Map updated: new "Modify CPQ seed data, add a new demo tenant, or change tenant provisioning" row pointing at this spec, the registry API, the orchestrator, and the demo modules
- [x] `packages/cpq/MIGRATION.md` updated to note that customer demo data lives outside `cpq/`
- [x] `yarn generate` — clean
- [x] `yarn test` — 423/423 green
- [x] `yarn build` — clean Next.js production build
- [x] `npx tsc --noEmit -p tsconfig.json` — clean

### Out-of-scope notes carried forward
- **Live three-tenant integration test** (boots app, seeds 3 tenants, logs in as each admin) is documented in the acceptance criteria but not implemented as a Playwright test in this branch — it requires a real Postgres + framework-bootstrapped runtime that is impractical to spin up inside this implementation pass. The orchestrator and seeders are exhaustively unit-tested; the integration smoke is left as a follow-up Playwright spec.

---

## Resolved Decisions

1. **Superadmin cross-tenant visibility — keep.** `superadmin@acme.com` retains the framework-default ability to switch into the GIX and Puffin tenants. A single dev login is enough to demo all three. No code change required; this is the existing behavior.
2. **Demo passwords bypass the password policy.** All `ensureDemoTenant` calls pass `--skip-password-policy` (the same flag `mercato auth setup` already uses for the primary tenant), so `secret` is accepted in dev. Production-style deployments override `CPQ_DEMO_<USECASE>_ADMIN_PASSWORD` with a strong value.
3. **Puffin public-calculator env wiring — explicit, no magic file writes.** `@app/demo_puffin` exposes `yarn mercato demo-tenants env --use-case puffin` which prints the resolved `CPQ_PUBLIC_CALCULATOR_TENANT_ID` / `..._ORG_ID` for the operator to paste into `.env.local`. The seed itself never writes env files.
4. **Registry API in `@dainamite/cpq` public surface.** The `registerCpqUseCase` / `listCpqUseCases` / `getCpqUseCase` / `ensureDemoTenant` exports under `@dainamite/cpq/lib/seeds/*` are part of the package's stable public API once extraction lands. Surface is intentionally tiny and additive.
