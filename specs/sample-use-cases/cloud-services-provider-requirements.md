# CPQ Requirements Specification — Cloud Services Provider (XD-252)

This file outlines requirements and specification for the CPQ module based on a Cloud Services Provider (CSP) use case. The deliverable is twofold: (1) seed the catalog, pricing tables and price rules to model the provider's offering inside the existing CPQ module, and (2) build a public-facing **pricing calculator** at `/pricing` that talks to the CPQ pricing API in real time and converts the visitor into a quote on submission.

> **Companion implementation specs**:
> - [Pricing Tables](../implementation/xd-186-pricing-tables.md)
> - [Calculate Price API](../implementation/xd-187-calculate-price-api.md)
> - [Price Rules](../implementation/xd-188-price-rules.md)
> - [Quoting](../implementation/xd-201-quoting.md)
> - [Bundled Offerings](../implementation/xd-223-bundled-offerings.md)
>
> **Reference seed implementation**: `src/modules/cpq/setup.ts` (GIX network services) and `src/modules/cpq/lib/seeds.ts` (wizard definition pattern).


# Use Case Description

The objective is to model a Cloud Services Provider's quoting domain — a company that sells programmable infrastructure to developers, agencies and enterprises.

Our CSP — **Puffin Cloud** — offers a portfolio of compute, storage, networking and security services across two EU regions (Frankfurt and Warsaw). Customers range from solo developers buying a single $5/month VPS to enterprises buying committed reserved instances with managed DDoS scrubbing and dedicated support.

Puffin differentiates from hyperscalers by:
- Predictable flat-rate VPS pricing alongside true per-minute on-demand compute
- A single quote that mixes flat-rate, usage-based, and tiered charges
- A transparent public pricing calculator (no signup required to see real numbers)


## Target Markets — Regions

Puffin operates two EU regions. Pricing is identical across both — region is a placement choice, not a pricing dimension. Customers pick a region per-line.

| # | Region Code | Display Name | Geo |
|---|-------------|--------------|-----|
| 1 | `fra1` | Frankfurt 1 | Germany |
| 2 | `waw1` | Warsaw 1 | Poland |


# Products

Puffin offers the following products. Each product is a `CpqProductSpecification` with one or more sellable `CpqProductOffering` entries.

- **Puffin VPS** — Fixed-size virtual private server billed monthly (MRC). Modelled as **one specification with seven discrete offerings** (`vps_nano`, `vps_micro`, `vps_small`, `vps_medium`, `vps_large`, `vps_xlarge`, `vps_mega`) — each offering is a separate sellable SKU with its own marketing name and its own MRC charge. The vCPU/RAM/disk for each plan live in `CpqProductOffering.designTimeValues` (read-only at quote time). The customer picks a plan card, then chooses `region`, `os_image`, and optional `backups`. This contrasts deliberately with the **Compute** product below, which uses a single offering driven by a multidimensional pricing table — one specification, two modelling styles, both in the same demo.

- **Puffin Compute** — On-demand instance compute billed **per-minute, post-paid usage**. **One specification, one offering**, configured by attributes against a `CpqPricingTable` (`instance_family` × `instance_size`). Customer chooses an `instance_family` (general / cpu-optimized / mem-optimized / gpu), `instance_size` (xs → 4xl), `region`, and provides an estimated **monthly active hours** for the calculator. Optional **Reserved Term** (1y / 3y) converts the per-minute charge to a discounted MRC plus a small NRC commitment fee.

- **Puffin Block Storage** — SSD volumes attached to VPS or Compute instances. Billed per **GB-month** (MRC). Customer chooses `volume_size_gb` (10 → 16,000) and `region`. Optional `iops_tier` (standard / provisioned).

- **Puffin Object Storage** — S3-compatible bucket storage billed per GB-month stored + per-GB egress + per-1k requests (all `usage` charges). Single global SKU, region pinned at create time.

- **Puffin CDN** — Global content delivery. Billed per **GB egress** with **5 volume tiers**, plus a flat **MRC platform fee**. Optional **WAF add-on** (`mrc`).

- **Puffin API Gateway / Functions** — Serverless functions and API gateway. Billed per **million requests** plus per **GB-second of compute**. Customer chooses `runtime` (node / python / go) and `memory_mb` (128 → 4096).

- **Puffin DDoS Shield** — DDoS protection plans. Three tiers (`standard` / `advanced` / `enterprise`) each with different mitigation capacity, SLA, and price (MRC). Can be attached to VPS, Compute or DNS. Enterprise tier requires a `contract_term_months` ≥ 12.

- **Puffin Managed Database** — The most attribute-rich product in the catalogue, designed to showcase `CpqProductAttribute` with type variety, dependencies, constraints and reference attributes. Engines: Postgres, MySQL, Redis, MongoDB. Configured by `db_engine`, `version` (depends on engine), `plan_size`, `region`, `ha_replicas` (0/1/2), `read_replicas` (0–5, requires `ha_replicas ≥ 1`), `backup_retention_days` (7/14/30), `pitr_enabled` (boolean, requires Pg/MySQL), `vpc_peering` (boolean), `parameter_group` (reference attribute), `maintenance_window` (text, cron-style). Pricing is a multidimensional table: `db_engine` × `plan_size` × `ha_replicas` plus surcharges for read replicas, PITR, and longer backup retention.

- **Puffin Workspace** — SaaS-seat licensing à la Microsoft 365 / Google Workspace, modelling **per-seat per-month subscription with plan tiers, add-ons and seat-count volume tiers**. One specification with four offerings: `workspace_essentials`, `workspace_business`, `workspace_business_premium`, `workspace_enterprise`. Each offering's MRC is `seat_price × seat_count`. Optional add-on offerings (separate SKUs, attached via relationship): `email_archive` (per-seat MRC), `advanced_threat_protection` (per-seat MRC, requires Business+), `extra_storage_tb` (per TB-month), `compliance_pack` (flat MRC, requires Enterprise). Discount stack: **seat-count volume tiers** (1–25 list, 26–100 −5%, 101–500 −10%, 500+ −15%) and **annual prepay −15%** — both implemented as composable `CpqPriceRule` rows so they multiply correctly.

- **Puffin Bandwidth** — Outbound egress not bundled with another product (e.g., from Object Storage, Compute). Tiered per-GB pricing. **Inbound is free.** Each VPS plan ships with a free monthly egress allowance — see Bandwidth Pricing.

- **Puffin Support** — Tiered support plans. Three tiers: Community (free), Developer ($29/mo flat), Business ($199/mo flat).

- **Puffin Premium Support** — A separate, **composite-priced** support product designed to showcase how `CpqPriceRule` can blend multiple charge components on one line. Pricing combines: (a) a base MRC of $500/mo, (b) a percentage-of-spend uplift `max(base, 6% × MRC subtotal excluding support)` via a `price_override` rule, (c) `included_tam_hours` (default 10) with overage at $250/hr (usage charge with included quantity), and (d) optional dedicated-phone + 15-min-SLA add-on (MRC). Reserved discounts apply: −10% on 1y, −18% on 3y. Calculator surfaces this with a live "$500 base + $312 (6% × $5,200 MRC) = $812/mo" breakdown so the composite pricing is legible to the visitor.


## Use-Case Bundles

Three bundles anchor the calculator's "Popular Configurations" carousel. Each bundle is a use-case story rather than a generic mix of products — the calculator presents them as **"I want to…"** entry points so a visitor who doesn't know the catalogue can land on something usable in one click.

### Modelling pattern: 1 specification, 3 offerings (packages)

Each bundle is **one `CpqProductSpecification` of type `bundle`** with **three `CpqProductOffering` packages** under it (Small / Medium / Large). The bundle's `CpqBundleSlot` rows define the *shape* of the stack (what slots exist, their components, min/max). Each offering's `designTimeValues` then prefills slot-level configuration to size the package: VPS plan codes, DB sizes, seat counts, retention days, add-on toggles. This shows off another modelling pattern in the framework — **packages as offerings on a shared spec** — distinct from the flat-offering pattern used by VPS or the attribute-driven pattern used by Compute / Managed DB.

The calculator surfaces each bundle as a single card with a 3-package toggle ("Solo · Standard · Pro"). Switching the toggle re-evaluates `designTimeValues` and re-prices.

Bundles use `CpqBundleSlot` + `CpqOfferingComponent` records (see `src/modules/cpq/data/entities.ts`).

---

### Bundle 1 — "Ship My App"  (spec: `bundle_dev_app`)

For solo developers and small teams deploying an app or side-project. Optimised for getting from `git push` to a live URL with predictable monthly cost.

**Slots (shared by all 3 packages):**

| Slot key | Component | Min | Max |
|----------|-----------|-----|-----|
| `app_host` | VPS | 1 | 1 |
| `database` | Managed DB (postgres) | 1 | 1 |
| `static_assets` | Object Storage | 1 | 1 |
| `cdn` | CDN | 0 | 1 |
| `support` | Support | 1 | 1 |

**Packages (offerings):**

| Offering | Package | App host | Database | CDN | Support | Indicative MRC |
|----------|---------|----------|----------|-----|---------|----------------|
| `dev_app_solo` | Solo Developer | VPS Puffling (`vps_nano`), backups on | postgres 16 sm ha-0, backups 7d | – (none) | Community (free) | **≈ $30 / mo** |
| `dev_app_standard` | Standard | VPS Atlantic (`vps_small`), backups on | postgres 16 sm ha-0, backups 14d | CDN (no WAF) | Developer ($29) | **≈ $100 / mo** |
| `dev_app_pro` | Pro | VPS Horned (`vps_medium`), backups on | postgres 16 md ha-1, pitr on, backups 30d | CDN (no WAF) | Business ($199) | **≈ $440 / mo** |

---

### Bundle 2 — "Run My Online Shop"  (spec: `bundle_ecommerce`)

For e-commerce shops — typically Magento, Shopware, WooCommerce, or PrestaShop on a managed VPS. Sized for shops growing from a few hundred SKUs to high-traffic brands.

**Slots:**

| Slot key | Component | Min | Max |
|----------|-----------|-----|-----|
| `storefront_host` | VPS | 1 | 2 |
| `database` | Managed DB (mysql) | 1 | 1 |
| `cache` | Managed DB (redis) | 0 | 1 |
| `media` | Object Storage | 1 | 1 |
| `cdn` | CDN | 1 | 1 |
| `ddos` | DDoS Shield | 1 | 1 |
| `bandwidth` | Bandwidth | 1 | 1 |
| `support` | Support | 1 | 1 |

**Packages (offerings):**

| Offering | Package | Host | Database | Cache | CDN | DDoS | Bandwidth est. | Support | Indicative MRC |
|----------|---------|------|----------|-------|-----|------|----------------|---------|----------------|
| `ecom_small_shop` | Small Shop | 1× VPS Atlantic (`vps_small`), backups on | mysql 8.4 sm ha-0, backups 14d | – | CDN (no WAF) | `standard` | 1 TB | Developer | **≈ $200 / mo** |
| `ecom_growing_shop` | Growing Shop | 1× VPS Horned (`vps_medium`), backups on | mysql 8.4 md ha-1, pitr on, backups 30d | redis sm ha-0 | CDN with WAF | `advanced` | 5 TB | Business | **≈ $1,050 / mo** |
| `ecom_high_volume` | High-Volume | 2× VPS Rhinoceros (`vps_large`), backups on | mysql 8.4 lg ha-1, pitr on, backups 30d | redis md ha-1 | CDN with WAF | `enterprise` (12-mo term) | 30 TB | Business | **≈ $4,400 / mo** |

---

### Bundle 3 — "Run My Business"  (spec: `bundle_business_office`)

For small/mid businesses hosting their corporate website + a couple of internal apps + the company's email/docs/chat. The bundle that ties Workspace to infrastructure on the same quote.

**Slots:**

| Slot key | Component | Min | Max |
|----------|-----------|-----|-----|
| `public_website` | VPS | 1 | 1 |
| `apps_host` | VPS | 0 | 2 |
| `shared_database` | Managed DB (postgres) | 1 | 1 |
| `file_storage` | Object Storage | 1 | 1 |
| `ddos` | DDoS Shield | 1 | 1 |
| `workspace_seats` | Workspace | 1 | 1 |
| `workspace_archive` | `ws_email_archive` add-on | 0 | 1 |
| `support` | Support | 1 | 1 |

**Packages (offerings):**

| Offering | Package | Public site | Apps host | Database | DDoS | Workspace | Support | Indicative MRC |
|----------|---------|-------------|-----------|----------|------|-----------|---------|----------------|
| `biz_small_team` | Small Team | VPS Atlantic (`vps_small`) | – (none) | postgres 16 sm ha-0, backups 14d | `standard` | `workspace_essentials`, 10 seats, annual prepay | Developer | **≈ $200 / mo** |
| `biz_growing` | Growing Business | VPS Atlantic (`vps_small`) | 1× VPS Horned (`vps_medium`) | postgres 16 sm ha-1, backups 30d | `standard` | `workspace_business`, 25 seats, annual prepay | Business | **≈ $580 / mo** |
| `biz_established` | Established Business | VPS Horned (`vps_medium`) | 2× VPS Horned (`vps_medium`) | postgres 16 md ha-1, pitr on, backups 30d | `advanced` | `workspace_business_premium`, 100 seats, annual prepay + email archive | Business | **≈ $3,700 / mo** |

---

### How the calculator presents these

- Three large cards on the landing screen, before any product picker is shown:
  - "Ship My App — from $30/mo"
  - "Run My Online Shop — from $200/mo"
  - "Run My Business — from $200/mo"
- Each card has a **3-state package toggle** (e.g., "Solo · Standard · Pro"). Switching the toggle picks a different `CpqProductOffering` under the same spec, re-evaluates `designTimeValues`, and re-prices live.
- Click "Use this bundle" → the cart fills with the bundle's slot lines using the selected offering's `designTimeValues`. Visitor can then tweak any line (resize a VPS, add seats, switch region to `waw1`) and the price updates live.
- Bundles are first-class offerings, so a sales rep can also start a backend quote from any of these via the existing `quoteContext.fromBundle = '<offeringId>'` flow — same data path, no separate code.


## Product Relationships

Modeled as `CpqProductRelationship` rows so the validator (`POST /api/cpq/quotes/validate-relationships`) enforces them at quote time.

```
DDoS Shield        ──── attached to ────▶  VPS | Compute | DNS
Block Storage      ──── attached to ────▶  VPS | Compute              (region must match parent)
WAF Add-On         ──── requires ──────▶  CDN
DDoS Enterprise    ──── requires ──────▶  contract_term_months ≥ 12
Reserved Compute   ──── excludes ──────▶  per-minute billing on the same line
Workspace ATP      ──── requires ──────▶  Workspace Business+
Workspace Compl.   ──── requires ──────▶  Workspace Enterprise
DB read_replicas   ──── requires ──────▶  ha_replicas ≥ 1
DB pitr_enabled    ──── requires ──────▶  db_engine ∈ {postgres, mysql}
Premium Support    ──── unique ─────────▶  at most one Premium Support line per quote
```

- All products are independently sellable (no hard parent requirement) **except**: Block Storage and DDoS Shield must reference an attachment target line, a CDN WAF add-on requires a CDN line, and Workspace add-ons attach to a Workspace line.
- A single quote can mix any number of products and regions. Region is per-line, not per-quote.
- Standard Support and Premium Support are mutually exclusive on the same quote.


# Pricing

## Pricing Models

All products support three contract models. The model is a quote-level attribute that applies a `CpqPriceRule` to all eligible lines.

| Model | Code | Description |
|-------|------|-------------|
| **On-Demand** | `on_demand` | No commitment. List prices. Month-to-month. |
| **Reserved 1-year** | `reserved_1y` | 12-month commitment. ~22% discount on eligible MRC. |
| **Reserved 3-year** | `reserved_3y` | 36-month commitment. ~38% discount on eligible MRC. |

Reserved pricing is eligible only for VPS, Compute, Managed Database, and DDoS Shield (advanced/enterprise). Storage and usage products always price as on-demand.


## Puffin VPS Pricing

**Modelling note**: VPS deliberately uses the **discrete-offerings** pattern. Each row in the table below is a separate `CpqProductOffering` (own UUID, own SKU, own slug, own `designTimeValues`, own `CpqProductCharge` records). The customer doesn't pick a "size" attribute — they pick an *offering*. Compare to Compute, which uses a single offering + a pricing table; both patterns are first-class in the framework.

Plans are flat MRC + a one-time NRC provisioning fee (typically waived on the calculator with a global `CpqPriceRule` of kind `discount_absolute`). Storage and bandwidth allowances are bundled.

| Offering Code | Marketing Name | vCPU | RAM (GB) | Disk (GB SSD) | Bundled Egress | NRC | MRC (USD) |
|---------------|----------------|------|----------|----------------|----------------|------|-----------|
| `vps_nano` | Puffling | 1 | 1 | 25 | 1 TB | 5.00 | 5.00 |
| `vps_micro` | Tufted | 1 | 2 | 50 | 2 TB | 5.00 | 12.00 |
| `vps_small` | Atlantic | 2 | 4 | 80 | 4 TB | 5.00 | 24.00 |
| `vps_medium` | Horned | 4 | 8 | 160 | 5 TB | 10.00 | 48.00 |
| `vps_large` | Rhinoceros | 8 | 16 | 320 | 6 TB | 10.00 | 96.00 |
| `vps_xlarge` | Crested | 16 | 32 | 640 | 8 TB | 20.00 | 192.00 |
| `vps_mega` | Emperor | 32 | 64 | 1280 | 10 TB | 20.00 | 384.00 |

(Puffin species used as plan codenames — fits the brand and gives the demo something distinctive to show on the cards.)

Modifiers (applied by `CpqPriceRule`, scoped via `applicabilityCondition` to any VPS offering):
- **Backups add-on** (`backups: true`): +20% on MRC
- **Reserved 1y**: −22% on MRC; **Reserved 3y**: −38% on MRC


## Puffin Compute (Per-Minute) Pricing

Pricing dimension table (`CpqPricingTable.dimensions = ['instance_family', 'instance_size']`, single price column `price_per_hour`). Calculator multiplies by `monthly_active_hours` and converts to monthly estimate. Stored internally as **per-second** (`price_per_hour / 3600`) for billing accuracy.

| Family | Size | vCPU | RAM (GB) | $/hour |
|--------|------|------|----------|--------|
| `general` | `xs` | 1 | 1 | 0.0083 |
| `general` | `sm` | 1 | 2 | 0.0167 |
| `general` | `md` | 2 | 4 | 0.0333 |
| `general` | `lg` | 4 | 8 | 0.0667 |
| `general` | `xl` | 8 | 16 | 0.1333 |
| `general` | `2xl` | 16 | 32 | 0.2667 |
| `general` | `4xl` | 32 | 64 | 0.5333 |
| `cpu-optimized` | `md` | 2 | 4 | 0.0395 |
| `cpu-optimized` | `lg` | 4 | 8 | 0.0790 |
| `cpu-optimized` | `xl` | 8 | 16 | 0.1580 |
| `cpu-optimized` | `2xl` | 16 | 32 | 0.3160 |
| `cpu-optimized` | `4xl` | 32 | 64 | 0.6320 |
| `mem-optimized` | `lg` | 4 | 32 | 0.1234 |
| `mem-optimized` | `xl` | 8 | 64 | 0.2468 |
| `mem-optimized` | `2xl` | 16 | 128 | 0.4936 |
| `mem-optimized` | `4xl` | 32 | 256 | 0.9872 |
| `gpu` | `gpu-t4` | 4 | 16 | 0.5240 |
| `gpu` | `gpu-a10` | 8 | 32 | 1.4500 |
| `gpu` | `gpu-a100` | 16 | 80 | 3.4500 |

Reserved pricing converts the per-minute usage charge to an MRC equal to `price_per_hour * 730 * (1 - reserved_discount)` plus a small NRC = `1 month MRC` as a commitment fee.


## Puffin Block Storage Pricing

Single price column, flat per GB-month. No tiering.

| IOPS Tier | $/GB/month | Notes |
|-----------|------------|-------|
| `standard` | 0.10 | Default. Up to 3,000 IOPS shared. |
| `provisioned` | 0.25 | Guaranteed up to 16,000 IOPS. |


## Puffin Object Storage Pricing

Three separate `CpqProductCharge` rows on the same offering — modelled like the WhatsApp composite pattern in the CPaaS spec.

| Charge | Type | Unit | Price |
|--------|------|------|-------|
| Stored data | `usage` | per GB-month | 0.020 |
| Egress | `usage` | per GB | 0.010 |
| Class A requests (PUT/POST/LIST) | `usage` | per 1,000 | 0.005 |
| Class B requests (GET/HEAD) | `usage` | per 10,000 | 0.004 |
| Platform fee | `mrc` | flat | 0.00 (free) |


## Puffin CDN Pricing

Tiered volume pricing on egress (`CpqPricingTable` with `range_from` / `range_to` on `monthly_egress_gb`). Single MRC platform fee.

| Tier | Range From (GB) | Range To (GB) | $/GB |
|------|-----------------|---------------|------|
| 0 | 0 | 10,000 | 0.085 |
| 1 | 10,001 | 50,000 | 0.070 |
| 2 | 50,001 | 150,000 | 0.055 |
| 3 | 150,001 | 500,000 | 0.040 |
| 4 | 500,001 | ∞ | 0.030 |

Plus:
- **Platform fee**: 25.00 MRC
- **WAF Add-on**: 50.00 MRC (separate offering, requires a CDN line)


## Puffin API Gateway / Functions Pricing

| Charge | Type | Unit | Price |
|--------|------|------|-------|
| Requests | `usage` | per 1,000,000 | 0.20 |
| Compute | `usage` | per GB-second | 0.0000166667 |
| Free tier | rule | 1M requests + 400k GB-s/month | rule waives the first 1M req and 400k GB-s |


## Puffin DDoS Shield Pricing

| Tier | Capacity | SLA | NRC | MRC | Reserved-eligible |
|------|----------|-----|-----|-----|-------------------|
| `standard` | 10 Gbps | 99.9% | 0 | 49.00 | no |
| `advanced` | 100 Gbps | 99.95% | 200.00 | 299.00 | yes |
| `enterprise` | 1 Tbps + scrubbing | 99.99% | 1,000.00 | 1,999.00 | yes (term ≥ 12 mo required) |


## Puffin Managed Database Pricing

This is the catalogue's **showcase product for attribute-driven configuration**. One spec, one offering, ~11 attributes resolved against pricing tables and price rules.

### Attributes (`CpqProductAttribute`)

| Attribute | Type | Options / Range | Depends On | Constraint |
|-----------|------|-----------------|-----------|------------|
| `db_engine` | enum | postgres / mysql / redis / mongodb | – | required |
| `version` | enum | populated dynamically | `db_engine` | required; options come from `referenceEntity` filtered by engine |
| `plan_size` | enum | sm / md / lg / xl / 2xl | – | required |
| `region` | enum | (9 regions) | – | required |
| `ha_replicas` | number | 0 / 1 / 2 | – | default 0 |
| `read_replicas` | number | 0–5 | `ha_replicas` | requires `ha_replicas ≥ 1` |
| `backup_retention_days` | enum | 7 / 14 / 30 | – | default 7 |
| `pitr_enabled` | boolean | true / false | `db_engine` | requires `db_engine ∈ {postgres, mysql}` |
| `vpc_peering` | boolean | true / false | – | default false |
| `parameter_group` | reference | (custom param groups) | `db_engine` | filtered by engine |
| `maintenance_window` | text | cron-style | – | optional |

Engine → version map:

| Engine | Versions |
|--------|----------|
| postgres | 14, 15, 16 |
| mysql | 8.0, 8.4 |
| redis | 7.2 |
| mongodb | 7.0 |

### Base MRC (multidimensional pricing table: `db_engine` × `plan_size` × `ha_replicas`)

| Engine | Plan | vCPU | RAM (GB) | Disk | HA-0 MRC | HA-1 MRC | HA-2 MRC |
|--------|------|------|----------|------|----------|----------|----------|
| postgres | sm | 1 | 2 | 25 | 18.00 | 36.00 | 54.00 |
| postgres | md | 2 | 4 | 80 | 60.00 | 120.00 | 180.00 |
| postgres | lg | 4 | 8 | 160 | 144.00 | 288.00 | 432.00 |
| postgres | xl | 8 | 16 | 320 | 320.00 | 640.00 | 960.00 |
| postgres | 2xl | 16 | 32 | 640 | 680.00 | 1,360.00 | 2,040.00 |
| mysql | sm | 1 | 2 | 25 | 18.00 | 36.00 | 54.00 |
| mysql | md | 2 | 4 | 80 | 60.00 | 120.00 | 180.00 |
| mysql | lg | 4 | 8 | 160 | 144.00 | 288.00 | 432.00 |
| mysql | xl | 8 | 16 | 320 | 320.00 | 640.00 | 960.00 |
| mysql | 2xl | 16 | 32 | 640 | 680.00 | 1,360.00 | 2,040.00 |
| redis | sm | 1 | 1 | – | 22.00 | 44.00 | 66.00 |
| redis | md | 2 | 4 | – | 75.00 | 150.00 | 225.00 |
| redis | lg | 4 | 8 | – | 165.00 | 330.00 | 495.00 |
| redis | xl | 8 | 16 | – | 360.00 | 720.00 | 1,080.00 |
| mongodb | sm | 1 | 2 | 25 | 24.00 | 48.00 | 72.00 |
| mongodb | md | 2 | 4 | 80 | 78.00 | 156.00 | 234.00 |
| mongodb | lg | 4 | 8 | 160 | 188.00 | 376.00 | 564.00 |
| mongodb | xl | 8 | 16 | 320 | 416.00 | 832.00 | 1,248.00 |

### Surcharges (composable `CpqProductCharge` rows on the same offering)

| Charge | Type | Formula |
|--------|------|---------|
| Read replicas | `mrc` | `read_replicas × (HA-0 MRC × 0.6)` |
| PITR add-on | `mrc` | `pitr_enabled ? HA-0 MRC × 0.15 : 0` |
| Backup retention surcharge | `mrc` | 14 days +5% on base; 30 days +12% on base |
| VPC peering | `mrc` | flat $20 |


## Puffin Bandwidth Pricing (Standalone Egress)

Tiered per-GB egress for any usage exceeding bundled allowances. Applied as a single-dimension pricing table on `monthly_egress_gb`.

| Tier | From (GB) | To (GB) | $/GB |
|------|-----------|---------|------|
| 0 | 0 | 10,000 | 0.012 |
| 1 | 10,001 | 50,000 | 0.010 |
| 2 | 50,001 | 150,000 | 0.008 |
| 3 | 150,001 | ∞ | 0.006 |

Inbound: free, all regions.


## Puffin Workspace Pricing

SaaS-seat licensing. Four offerings under one specification — each offering's primary charge is `seat_price × seat_count` modelled as a `usage` charge with `quantityAttribute = 'seat_count'`.

### Plan Offerings

| Offering Code | Marketing Name | Seat Price (USD/mo) | Storage / seat | Notes |
|---------------|----------------|---------------------|-----------------|-------|
| `workspace_essentials` | Workspace Essentials | 6.00 | 30 GB | Mail + calendar + chat |
| `workspace_business` | Workspace Business | 12.00 | 2 TB | + Office apps + 100-participant video |
| `workspace_business_premium` | Workspace Business Premium | 22.00 | 2 TB | + advanced security + endpoint mgmt |
| `workspace_enterprise` | Workspace Enterprise | 35.00 | 5 TB | + DLP + audit + 250-participant video |

### Add-on Offerings (separate SKUs, attach to a Workspace line)

| Add-on | Code | Pricing | Requires |
|--------|------|---------|----------|
| Email Archive (10 yr retention) | `ws_email_archive` | $3.00 / seat / mo | any plan |
| Advanced Threat Protection | `ws_atp` | $2.50 / seat / mo | Business+ |
| Extra Storage | `ws_extra_storage` | $0.020 / GB / mo | any plan |
| Compliance Pack (HIPAA/FINRA) | `ws_compliance` | $499 / mo flat | Enterprise |

### Discount Stack (composable `CpqPriceRule` rows)

Both rules are `discount_percent` and apply to all Workspace charges (base + add-ons) on the line. They multiply, so a 150-seat Business annual line gets 0.90 × 0.85 = 0.765.

| Rule Code | Trigger | Discount |
|-----------|---------|----------|
| `ws_volume_25` | `seat_count ≥ 26` | −5% |
| `ws_volume_100` | `seat_count ≥ 101` | −10% |
| `ws_volume_500` | `seat_count ≥ 501` | −15% |
| `ws_annual_prepay` | `quoteContext.billing_cadence = 'annual_prepay'` | −15% |

Volume rules are mutually exclusive — only the highest-eligible tier applies (enforced via `priority` ordering).


## Puffin Support Pricing

Three flat tiers. Premium Support is a **separate product** (next section), not a fourth tier here, because its composite pricing model is meaningfully different.

| Tier | Code | Pricing | Response SLA |
|------|------|---------|--------------|
| Community | `support_community` | Free | Best effort |
| Developer | `support_developer` | $29/mo flat | < 12h business |
| Business | `support_business` | $199/mo flat | < 1h 24/7 |


## Puffin Premium Support Pricing

Composite pricing — designed to showcase how multiple `CpqProductCharge` rows + `CpqPriceRule` rows compose on a single line. The customer-visible total breaks down on the calculator like an itemised receipt.

### Charges on the offering

| Charge | Type | Formula |
|--------|------|---------|
| Base subscription | `mrc` | $500 flat |
| Spend-uplift (price override) | `mrc` | `max(0, 0.06 × quote.totals.mrc_excluding_support − 500)` |
| Included TAM hours | `usage` (with `included_quantity`) | 10 hrs included, $250/hr overage |
| Dedicated phone + 15-min SLA | `mrc` | $250 flat (optional add-on, attribute `dedicated_line: true`) |

### Contract discounts

| Reserved term | Discount on MRC components |
|---------------|----------------------------|
| 1y | −10% |
| 3y | −18% |

### Worked examples (calculator surfaces these as line breakdowns)

| Scenario | mrc_excl_support | Base | Uplift | Total / mo |
|----------|------------------|------|--------|-------------|
| Small cart | $1,000 | $500 | $0 (floor binds) | **$500** |
| Mid cart | $5,200 | $500 | $312 | **$812** |
| Big cart | $40,000 | $500 | $1,900 | **$2,400** |

Implementation: the spend-uplift charge is a `CpqPriceRule` of type `price_override` evaluated **after** every other line on the quote is priced — its `applicabilityCondition` references `quote.totals.mrc` minus any charges whose `chargeCode` starts with `support_` or `premium_support_`.


# Quoting Journey (Sales-Led)

For sales-rep-driven quotes through the existing backend wizard at `/backend/cpq/quotes`:

1. **Select Customer** — existing customer or create new (uses `CustomerService`).
2. **Choose Contract Model** — On-Demand / Reserved 1y / Reserved 3y.
3. **Add Products** — sales rep adds one or more lines:
   - VPS, Compute, Block Storage, Object Storage, CDN, API Gateway, DDoS Shield, Managed DB, Workspace, Bandwidth, Support, Premium Support.
4. **Configure Each Line** — region + product-specific attributes.
5. **Validate Relationships** — `POST /api/cpq/quotes/validate-relationships` ensures e.g. Block Storage attachment target exists.
6. **Recalculate** — `POST /api/cpq/quotes/{id}/recalculate` runs the pricing engine end-to-end (Premium Support recomputes last).
7. **Review & Send** — quote status transitions `incomplete → ready → with_customer`.


# Public Pricing Calculator (XD-252 main deliverable)

A polished, conversion-oriented calculator at `/pricing` (route: `src/app/(frontend)/pricing/page.tsx` or via the existing catch-all `(frontend)/[...slug]/page.tsx` registered as a frontend route in a new `csp-calculator` module under `src/modules/`).

## Goals

1. Anonymous visitors can configure any combination of products and see **live, accurate** pricing within 200ms of any change.
2. The calculator pulls everything (products, attributes, prices) from the same database and APIs the backend uses — **no hardcoded prices in the frontend**. If a sales engineer edits a price rule, the calculator reflects it on next page load.
3. The "Get a Quote" CTA captures lead identity and persists the configured cart as a real `CpqQuoteConfiguration` (status: `with_customer`) that the sales team sees in the backend.

## UX / UI Design

Single-page, dark theme with gradient accents (purple → cyan), monospace numerics. The calculator is a **two-path flow**: visitors land on a chooser, pick a path, and only then see the configurator. The path can be switched at any time without losing cart state.

### Step 0 — Landing chooser ("How do you want to start?")

The first screen replaces the legacy product grid. Two big choice cards, equal weight:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Hero                                                                   │
│  "Build your Puffin Cloud stack."                                       │
│  [ Region: Frankfurt ▾ ]  [ Currency: USD ▾ ]  [ Term: On-Demand ▾ ]    │
└─────────────────────────────────────────────────────────────────────────┘

           ┌─────────────────────────┐   ┌─────────────────────────┐
           │   ✨ Predefined         │   │   🛠  Custom            │
           │      Solutions         │   │      Solution           │
           │                         │   │                         │
           │  Pick a use case +     │   │  Pick products one by   │
           │  package. One click,   │   │  one and configure each │
           │  fully sized.          │   │  attribute yourself.    │
           │                         │   │                         │
           │  [ Browse solutions ]  │   │  [ Start from scratch ] │
           └─────────────────────────┘   └─────────────────────────┘

   Below: small text — "Not sure? Start with a solution, you can
                        customise everything afterwards."
```

This step has **no API calls**; it's a pure router. Picking a card sets `?flow=solutions` or `?flow=custom` in the URL and renders the matching screen.

### Step 1A — Predefined Solutions flow

Three large cards, one per use-case bundle. Each card has the 3-state package toggle described in **Use-Case Bundles**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ◀ back                              choose a solution                  │
└─────────────────────────────────────────────────────────────────────────┘
┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐
│  Ship My App           │ │  Run My Online Shop    │ │  Run My Business       │
│  for developers        │ │  for shop owners       │ │  for SMBs              │
│                        │ │                        │ │                        │
│  ( Solo · Std · Pro )  │ │ ( Small · Grow · High) │ │ ( Team · Grow · Estd ) │
│  ── slider toggle ──   │ │ ── slider toggle ──    │ │ ── slider toggle ──    │
│                        │ │                        │ │                        │
│  $30 / $100 / $440 mo  │ │ $200 / $1,050 / $4,400 │ │ $200 / $580 / $3,700   │
│  (preview, live)       │ │ (preview, live)        │ │ (preview, live)        │
│                        │ │                        │ │                        │
│  [ Use this bundle ]   │ │ [ Use this bundle ]    │ │ [ Use this bundle ]    │
└────────────────────────┘ └────────────────────────┘ └────────────────────────┘

   "Want full control? Switch to Custom Solution →"
```

- The 3-state toggle on each card swaps the underlying `CpqProductOffering` and re-prices the **card preview** live (not yet in the cart).
- Clicking **"Use this bundle"** pushes every slot's `designTimeValues` into the cart and advances to **Step 2 — Configurator** with all bundle lines pre-populated and editable.
- A persistent footer link offers **"Switch to Custom Solution"** which keeps the cart and just swaps the picker style.

### Step 1B — Custom Solution flow

The familiar two-pane layout: product catalogue on the left, sticky live cart on the right. Visitors add products one at a time and configure each.

```
┌──────────────────────────────────────────────┬──────────────────────────┐
│  ◀ back to chooser   |   product catalogue   │  Live Cart (sticky)      │
│                                              │                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐       │  ┌──────────────────────┐│
│  │  VPS    │  │ Compute │  │  CDN    │  …   │  │ 1× VPS Atlantic /fra1││
│  │  ▶ Add  │  │  ▶ Add  │  │  ▶ Add  │       │  │   $24.00 / mo        ││
│  └─────────┘  └─────────┘  └─────────┘       │  │ 1× CDN (10TB est.)   ││
│                                              │  │   $612.00 / mo (est) ││
│  Expanding a card reveals attribute pickers  │  ├──────────────────────┤│
│  + quantity steppers. Inline price per option│  │ MRC subtotal  $636   ││
│                                              │  │ NRC one-time  $5     ││
│  Footer link: "Browse predefined solutions"  │  │ Usage est.    $0.45  ││
│                                              │  ├──────────────────────┤│
│                                              │  │ [ Get a Quote ]      ││
│                                              │  └──────────────────────┘│
└──────────────────────────────────────────────┴──────────────────────────┘
```

### Step 2 — Configurator (shared by both flows)

After either path, the visitor sees the **same** configurator: the cart on the right and an editable list of lines on the left. Every line has a "Configure" expandable that opens the per-product UI pattern (see table below). This is the convergence point — Predefined Solutions arrives here pre-populated; Custom Solution arrives here empty and the visitor adds one product at a time. Switching flows from this screen via the footer link does **not** clear the cart.

### Interaction Details

- **Two-path flow state** is held in the URL: `/?flow=solutions` or `/?flow=custom`. Refresh-safe and shareable. No flow → renders the chooser.
- **Cart persists across flow switches.** Switching from Custom to Predefined doesn't clear lines; loading a bundle on top of an existing cart prompts "Replace cart or merge?".
- **Product cards** in Custom flow render from `GET /api/cpq/public/catalog`. Each card icon, name, tagline, "from $X/mo" come from offering metadata. Catalog is cached 60s.
- **Bundle cards** in Solutions flow render from the same catalogue endpoint, filtered to specifications of `type: 'bundle'`.
- **Card-level package preview** in Solutions flow calls `POST /api/cpq/public/price` once per toggle change with that offering's `designTimeValues` materialised as `childItems` — preview only, doesn't touch the real cart.
- **Attribute pickers** are rendered from `POST /api/cpq/public/attributes` with the partial configuration. As the user changes a value, dependent attributes refresh (e.g., DB `version` options change when `db_engine` changes).
- **Quantity steppers** for things billed per unit (storage GB, egress GB, instance count, monthly hours, seat count).
- **Live re-pricing** debounced at 250 ms calls `POST /api/cpq/public/price` with all current cart lines as `childItems`. The response populates the sticky cart on the right.
- **Region switcher** in the hero re-prices everything; if a chosen attribute combo isn't available in the new region, the offending line surfaces a warning chip.
- **Term switcher** (On-Demand / 1y / 3y) sets `quoteContext.contract_model` and re-prices.
- **Permalink**: full state (flow + cart) is serialized into the URL query string (`?flow=...&cart=<base64-json>`), so a shareable URL reproduces the configuration on a fresh browser.
- **Empty state in Custom flow**: a small "Browse predefined solutions" CTA replaces the empty cart copy, nudging undecided visitors back to the easier path.
- **Errors** (e.g., relationship validation failures from the backend) appear as inline chips on the offending line, never blocking the price preview itself.

### Per-Product UI Patterns (deliberately varied to showcase the framework)

| Product | UI pattern | Why this pattern |
|---------|-----------|------------------|
| **VPS** | **Plan-card grid** — 7 visual cards (Puffling → Emperor) with vCPU/RAM/disk badges. Click selects an offering. Region/OS/backups picked secondarily. | Showcases the "discrete offerings" model — each card *is* an offering. |
| **Compute** | Two-step dropdown: instance family → instance size, with a $/hour readout next to each size and a `monthly_active_hours` slider. | Showcases the multidimensional pricing-table model with a single offering. |
| **Managed DB** | Wide configurator panel: engine pills → version dropdown (engine-dependent) → plan size cards → HA toggle → read-replica stepper (disabled until HA ≥ 1) → checkboxes for PITR / VPC peering → backup retention pills. | Showcases attribute dependencies, constraints, reference attributes, and how dependent attributes refresh live. |
| **Workspace** | Plan tier toggle (4 plans) + **seat-count slider (1–1000)** + add-on checkboxes. The slider shows discount badges in real time ("you're saving 10% at 150 seats"). Annual-prepay toggle in the panel header. | Showcases per-seat pricing, volume tiers as composable price rules, and rule stacking (volume × annual). |
| **Premium Support** | Single card with a live itemised breakdown: Base $500 + Spend uplift (live computed) + included TAM hours stepper + dedicated-line toggle + reserved term. Recomputes whenever any other line changes. | Showcases composite pricing with a `price_override` rule that depends on the rest of the cart. |
| **CDN, Object Storage, Bandwidth** | Single panel with one or two sliders (egress GB, storage GB) and a tier-visualisation bar that highlights which tier the slider lands in. | Showcases tiered volume pricing and free-tier rules. |
| **DDoS Shield** | Three-tier comparison cards. Selecting Enterprise reveals a contract-term picker (≥12mo). | Showcases tier-based offerings with conditional attribute requirements. |

### "Get a Quote" Flow

Clicking the CTA opens a slide-over with a 3-field form (name, work email, company). On submit:

1. `POST /api/cpq/public/leads` (new endpoint) creates a lead `Customer` record (status `lead`) and returns a short-lived `quote_session_token` (signed JWT, 10 min TTL).
2. Frontend calls `POST /api/cpq/quotes` with that token, then loops `POST /api/cpq/quotes/{id}/items` for every cart line, then `PATCH /status` to `with_customer`.
3. Confirmation: shows the quote number, sends a confirmation email with a magic-link to the customer portal where they can accept the quote.

If a captcha hook fails, the lead/quote is not created.

## Public-API & Auth Architecture

The current `/api/cpq/quotes/price` route requires `requireAuth: true` and feature flag `cpq.quotes.view`. We must **not** weaken that endpoint. Two new routes are introduced under `/api/cpq/public/*` with their own feature flag `cpq.public.calculator`:

| New Route | Method | Auth | Notes |
|-----------|--------|------|-------|
| `/api/cpq/public/catalog` | GET | none | Returns offerings flagged `listedInCalculator: true` plus their attributes. Cached 60s. |
| `/api/cpq/public/attributes` | POST | none | Thin proxy to `cpqProductAttributesService.resolveOptions()` filtered to public offerings. Rate-limited (60 req/min/IP). |
| `/api/cpq/public/price` | POST | none | Thin proxy to `cpqPricingService.resolveProductCharges()` filtered to public offerings. Rate-limited. Forces `quoteContext.public_calculator = true`. |
| `/api/cpq/public/leads` | POST | none | Captcha-protected. Creates lead Customer, returns short-lived `quote_session_token`. |
| `/api/cpq/public/quotes` | POST | `quote_session_token` | Wraps the standard quote-creation endpoints; only callable with a fresh session token; one quote per token. |

The public routes share a dedicated DI-resolved `cpqPublicCalculatorService` (new file: `src/modules/cpq/services/cpqPublicCalculatorService.ts`) that:
- Filters offerings by `metadata.listedInCalculator === true` AND `lifecycleStatus === 'active'`.
- Strips internal pricing metadata (cost basis, margin) from responses.
- Resolves the calculator's "demo tenant" (a single seeded tenant/org used for public pricing — configured via env var `CPQ_PUBLIC_CALCULATOR_TENANT_ID` / `..._ORG_ID`).

Rate limiting uses the existing request middleware; default 60 req/min/IP, configurable per route.


# Business Rules

### Rule 1: Reserved term commitment
When `quoteContext.contract_model = reserved_1y` or `reserved_3y`, only eligible products (VPS, Compute, Managed DB, DDoS Shield advanced/enterprise) receive the discount. Storage and Object Storage charges are unchanged.

### Rule 2: Reserved Compute is not per-minute
A line whose `compute.contract_model` is `reserved_*` switches its primary charge from `usage` to `mrc`. The pricing service must select the right charge based on the configuration; this is implemented as **two charges with mutually-exclusive applicability conditions** on the same offering, not as code branching in the service.

### Rule 3: Bundled egress
Each VPS plan ships with a free monthly egress allowance. The calculator deducts the allowance from the user-entered `monthly_egress_gb` before pricing the standalone Bandwidth product on the same line's region.

### Rule 4: API Gateway free tier
The first 1,000,000 requests and 400,000 GB-s per month per quote are free. Modeled as a `CpqPriceRule` that subtracts from the `usage` total, never below zero.

### Rule 5: DDoS Enterprise commitment
DDoS Shield Enterprise requires `contract_term_months >= 12`. The validate-relationships endpoint must reject otherwise.

### Rule 6: Block Storage attachment
A Block Storage line must reference (`parentLineId`) a VPS or Compute line, and the two must share the same `region`. Validation enforced by `validate-relationships`.

### Rule 7: Public calculator filter
Only offerings with `metadata.listedInCalculator === true` are returned by `/api/cpq/public/*`. This is independent of `lifecycleStatus`, but inactive offerings are also hidden.

### Rule 8: Lead → Quote one-shot
A `quote_session_token` may create exactly one quote. Reusing it returns 409.

### Rule 9: Premium Support pricing
Premium Support MRC is `max(500, 0.06 × sum_of_mrc_excluding_support)`. Implemented via a `price_override` `CpqPriceRule` on the `premium_support` offering with priority guaranteeing it evaluates after every other line. TAM-hour overage (above the 10 included) is a separate `usage` charge at $250/hr.

### Rule 10: Workspace seat-volume tiers
Workspace volume rules are mutually exclusive — only the highest-eligible tier applies. Annual prepay multiplies on top.

### Rule 11: Workspace add-on plan gating
ATP requires Business or Business Premium or Enterprise. Compliance Pack requires Enterprise. Enforced at `validate-relationships`.

### Rule 12: DB attribute dependencies
`read_replicas > 0` requires `ha_replicas ≥ 1`. `pitr_enabled = true` requires `db_engine ∈ {postgres, mysql}`. `version` options are filtered by `db_engine`. All enforced both client-side (calculator disables invalid options) and server-side (`validate-relationships` rejects).

### Rule 13: Standard vs Premium Support exclusivity
A quote may include at most one of: `support_developer`, `support_business`, `premium_support`. Adding Premium Support replaces any standard support line on the same quote.


# Specification / Design

1. **Reuse standard CPQ entities.** No new tables. The model fits cleanly into `CpqProductSpecification`, `CpqProductOffering`, `CpqProductAttribute`, `CpqPricingTable`, `CpqProductCharge`, `CpqPriceRule`, `CpqQuoteConfiguration`, and `CpqQuoteLineConfiguration`. Reference `src/modules/cpq/data/entities.ts`.

2. **New `csp-calculator` module** under `src/modules/csp-calculator/`:
   - `setup.ts` — seeds catalog, pricing tables, price rules (mirroring `src/modules/cpq/setup.ts` for GIX).
   - `data/entities.ts` — empty (no new entities) but module is registered to host its frontend page and seeds.
   - `index.ts` — registers a frontend route `/pricing` and a backend page `/backend/csp-calculator/settings` (toggle which offerings are listed).
   - Add to `src/modules.ts` with `from: '@app'`.

3. **Catalog flagging.** Add a single boolean `listedInCalculator` inside `CpqProductOffering.metadata`. No schema migration. The backend offerings list page (`/backend/cpq/offerings`) gets a column + bulk action.

4. **Public API surface** lives in `src/modules/cpq/api/public/` (new directory) — keep it inside the `cpq` module so it ships with the framework, not the demo. Each route has `metadata: { POST: { requireAuth: false, requireFeatures: ['cpq.public.calculator'] } }` and uses a new `resolveCpqPublicRouteContext()` that loads tenant/org from env config rather than auth.

5. **Pricing reuse.** The public `price` endpoint instantiates the existing `DefaultCpqPricingService` and calls `resolveProductCharges` — the service is already context-agnostic. Tenant/org are passed explicitly. No service-layer changes needed.

6. **Per-second compute charges.** Internally store `price_per_second = price_per_hour / 3600`. Surface to the calculator as `$/hour` for human readability. Quote line stores `usage_quantity` in seconds for billing accuracy.

7. **Bundles seeded as 3 `CpqProductSpecification`s of type `bundle`** (`bundle_dev_app`, `bundle_ecommerce`, `bundle_business_office`), each with **3 `CpqProductOffering` packages** (Solo / Standard / Pro for Bundle 1, Small Shop / Growing Shop / High-Volume for Bundle 2, Small Team / Growing Business / Established Business for Bundle 3). Slots live on the spec; package-specific sizing lives in each offering's `designTimeValues`. The calculator's "Use this bundle" button posts `quoteContext.fromBundle = '<offeringId>'` and expands to one line per slot. Slot `min`/`max` (e.g., 0–2 apps host in the business bundle) are surfaced as quantity steppers per slot after the bundle is loaded.

8. **No new auth model.** The public routes use a per-IP rate limit and a captcha (recaptcha v3) on `/api/cpq/public/leads`. The `quote_session_token` is a signed JWT with claims `{ leadId, scope: 'one_quote', exp }` issued by `/leads`. Only `/quotes` accepts it.

9. **Currency.** Default `USD`. The hero currency switcher passes `currencyCode` to the price endpoint. Multi-currency pricing tables are out of scope for the demo (single currency seed); FX conversion can come from `core/currencies` in a follow-up.

10. **Telemetry hook.** Each `POST /api/cpq/public/price` emits a `csp.calculator.priced` event (existing event bus) so we can later A/B test pricing pages and measure conversion.

11. **Demo polish.**
    - Animated number transitions on cart totals (CSS `font-variant-numeric: tabular-nums`).
    - Skeleton loaders on first paint (catalog from cached SSR).
    - Mobile: cards stack; cart docks to bottom as a sheet.
    - Three "as seen on" logos in the footer (placeholder).

12. **Out of scope for the demo:** real billing integration, real DDoS provisioning, customer self-service portal beyond the magic-link quote acceptance, multi-currency, role-based pricing.


# Acceptance Criteria

The XD-252 deliverable is considered done when:

- [ ] `yarn db:greenfield && yarn generate && yarn dev` produces a running app where `/pricing` is reachable without login, displaying the Puffin Cloud brand.
- [ ] **Step 0 chooser** is the default landing screen with no flow query param, presenting two equal-weight cards: **Predefined Solutions** and **Custom Solution**. Choosing a card sets `?flow=solutions` or `?flow=custom` and navigates to the matching screen.
- [ ] **Predefined Solutions flow** lists the 3 use-case bundle cards. Clicking "Use this bundle" loads slot lines into the cart and lands the visitor on the configurator with all lines pre-populated and editable.
- [ ] **Custom Solution flow** opens with an empty cart and the product catalogue. The visitor can add and configure products one at a time.
- [ ] **Flow switching is non-destructive.** A visitor with items in the cart can toggle between Predefined Solutions and Custom Solution without losing their configuration; loading a bundle on top of an existing cart prompts "Replace cart or merge?".
- [ ] All product types listed above can be configured in the calculator, with prices that match the tables in this spec.
- [ ] Switching region, term, or any attribute updates the right-hand cart total in under 250ms (single round-trip to `/api/cpq/public/price`).
- [ ] **VPS** plans render as **7 distinct offering cards** (Puffling → Emperor); selecting one creates a single line whose configuration carries `offeringId`, not a `plan` attribute.
- [ ] **Compute** renders as a single offering with a family-then-size dropdown; switching family refreshes the size options live.
- [ ] **Managed DB** attribute panel: changing `db_engine` refreshes the `version` dropdown to engine-specific values; `read_replicas` stepper is disabled until `ha_replicas ≥ 1`; `pitr_enabled` is disabled when engine is redis or mongodb.
- [ ] **Workspace** at 150 Business seats with annual prepay prices to `150 × $12 × 0.90 (volume) × 0.85 (annual) = $1,377.00 / mo`. Volume-tier badge surfaces at 26, 101, and 501 seats.
- [ ] **Premium Support** on a $5,200/mo cart prices to $812/mo (composite breakdown visible); on a $1,000/mo cart it prices to $500/mo (floor binds); recomputes within 250ms when any other line changes.
- [ ] Each of the 3 use-case bundles renders as a card with a 3-state package toggle (Solo / Standard / Pro for "Ship My App"; Small Shop / Growing Shop / High-Volume for "Run My Online Shop"; Small Team / Growing Business / Established Business for "Run My Business").
- [ ] Switching the package toggle on a card swaps the underlying `CpqProductOffering` and re-prices the preview total within 250ms — without leaving the card.
- [ ] Clicking "Use this bundle" loads all slot lines into the cart in `fra1`, USD, on-demand, and the cart total is within ±5% of the indicative monthly totals quoted in this spec for the selected package.
- [ ] After loading a bundle, individual lines (region, VPS plan, seat count, etc.) can be tweaked and the cart re-prices live without losing the rest of the bundle.
- [ ] Submitting "Get a Quote" creates a `lead` Customer and a `with_customer` `CpqQuoteConfiguration` visible in `/backend/cpq/quotes`.
- [ ] No price exists in the frontend bundle — switching off `listedInCalculator` on an offering hides it from `/pricing` without a redeploy.
- [ ] All public endpoints rate-limit at 60 req/min/IP and reject without a token where required.
- [ ] Relationship rules (Rules 5, 6, 11, 12, 13) are enforced both in the calculator (inline chip) and at the API (validate-relationships rejection).
- [ ] Permalinks (`/pricing?cart=...`) reproduce the cart state on a fresh browser.
- [ ] Mobile layout is usable down to 360px width.
