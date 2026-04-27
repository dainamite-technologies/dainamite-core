# CPQ Engine — Blueprint

This document is the top-level blueprint for the Open Mercato CPQ (Configure, Price, Quote) engine. It defines the domain model, bounded contexts, and their relationships. The engine is **product-agnostic** — all domain knowledge lives in configuration data, not code.

> **Existing specs**: `cpq-requirements.md` (GIX use case), `cpq-spec.md` (v1 implementation), `cpq-v2-spec.md` (v2 design with rules engine).
> **Domain specs**: See `specs/domains/` for per-domain requirements.

---

## Domain Model

The CPQ engine is decomposed into 7 bounded domains:

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  Product Domain  │────>│  Pricing Engine       │<────│  Cost Domain        │
│                  │     │  Domain               │     │                     │
└────────┬─────── ┘     └──────────┬───────────┘     └─────────────────────┘
         │                          │
         │                          │
         v                          v
┌─────────────────┐     ┌──────────────────────┐
│  Business Rules  │────>│  Quoting Domain       │
│  Domain          │     │                       │
└─────────────────┘     └──────────┬───────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    v                               v
         ┌──────────────────┐            ┌──────────────────┐
         │  Product          │            │  Workflow         │
         │  Inventory Domain │            │  Domain           │
         └──────────────────┘            └──────────────────┘
```

| # | Domain | Objective | Spec |
|---|--------|-----------|------|
| 1 | [Product](domains/product.md) | Define product specifications, configurable attributes, and commercial structure | `domains/product.md` |
| 2 | [Pricing Engine](domains/pricing-engine.md) | Calculate prices for configured products at quoting runtime | `domains/pricing-engine.md` |
| 2a | [Pricing Tables](domains/pricing-tables.md) | Define and manage pricing matrices consumed by the price engine | `domains/pricing-tables.md` |
| 2b | [Calculate Price API](domains/calculate-price-api.md) | Stateless real-time price calculation endpoint for the quoting wizard | `domains/calculate-price-api.md` |
| 2c | [Simple Price Rules](domains/price-rules.md) | Data-driven post-calculation rules that apply discounts, surcharges, and overrides to resolved charges | `domains/price-rules.md` |
| 3 | [Quoting](domains/quoting.md) | Produce structurally correct quotes with validated configurations and calculated prices | `domains/quoting.md` |
| 4 | [Cost](domains/cost.md) | Maintain product cost definitions and calculate margins | `domains/cost.md` |
| 5 | [Business Rules](domains/business-rules.md) | Hold and evaluate business rules at quoting runtime | `domains/business-rules.md` |
| 6 | [Product Inventory](domains/product-inventory.md) | Track what customers have already purchased | `domains/product-inventory.md` |
| 7 | [Workflow](domains/workflow.md) | Define custom guided quoting workflows | `domains/workflow.md` |

---

## Cross-Cutting Requirements

### R-GEN-1: Product Agnostic
All product-specific knowledge (attributes, charges, pricing, rules) is expressed as **data**. Adding a new product requires only database records, not code changes. The GIX telecom use case is a reference implementation via seed data.

### R-GEN-2: Open-Close Principle
The CPQ engine is implemented as an `@app` module. No modifications to `@open-mercato/*` packages. Extensions happen through DI, injection widgets, and event subscribers.

### R-GEN-3: Multi-Tenancy
All entities are scoped by `organizationId` + `tenantId`. Product catalogs, pricing, rules, and inventory are tenant-isolated.

### R-GEN-4: Standard Integration
Quotes and orders use standard `SalesQuote` / `SalesOrder` entities. CPQ extends them via companion entities and JSONB configuration fields, not by replacing them.

### R-GEN-5: Extensibility via DI
All CPQ services are registered in the Awilix DI container and can be overridden by downstream consumers.

### R-GEN-6: Multi-Currency
All pricing and cost entities carry a `currencyCode`. The engine does not perform currency conversion — prices are stored in their native currency.

---

## Domain Interactions

| Interaction | From | To | Mechanism |
|------------|------|-----|-----------|
| Attribute & charge definitions describe a product | Product | Pricing Engine | Charge references pricing table + column |
| Pricing engine calculates charges for a configuration | Pricing Engine | Quoting | Service call during quote creation |
| Business rules constrain configuration and validate quotes | Business Rules | Quoting, Product | Rule engine evaluated at configuration time |
| Cost engine calculates margins for quoted items | Cost | Quoting | Service call after pricing |
| Quote finalization creates inventory records | Quoting | Product Inventory | Event subscriber on order creation |
| Existing inventory informs quoting decisions | Product Inventory | Quoting | Customer's active items queried at quote start |
| Workflow orchestrates the quoting journey steps | Workflow | Quoting | Wizard step definitions drive UI flow |
| Pricing rules can modify calculated prices | Business Rules | Pricing Engine | Post-calculation rule evaluation |

---

## Implementation Status

| Domain | Status | Notes |
|--------|--------|-------|
| Product | v1 done, v2 planned | v1 has attributes + charges. v2 adds `CpqProductConfig`, reference attributes, attribute groups |
| Pricing Engine | v1 done, v2 planned | v1 has flat/tiered/per_unit. v2 adds volume model, pricing rules, date-versioned tables |
| Quoting | v1 done | Wizard flow with 5 steps, quote configuration entity |
| Cost | not started | New domain — margin calculation |
| Business Rules | v1 partial, v2 planned | v1 has hard-coded rules. v2 has full rule engine with typed rule classes |
| Product Inventory | v1 done | Inventory items with parent/child, customer tab injection |
| Workflow | not started | New domain — configurable wizard flows |
