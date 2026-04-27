---
name: cpq-products
description: Product catalog work in CPQ — specifications (blueprints), offerings (sellable instances), attributes, charges, relationships (requires/excludes/parent_child), bundles (slots + components). Load when modifying anything that defines what is configurable or how pieces fit together, before pricing kicks in.
---

# CPQ — Products: Specifications, Offerings, Bundles

## Mental model

```
CpqProductSpecification    blueprint — "what kind of thing"
        │
        ├─ CpqProductAttribute    configurable knobs (data_centre, port_size, …)
        ├─ CpqProductCharge       what gets billed (NRC/MRC/usage)
        ├─ CpqBundleSlot          for bundles: which slot can hold which sub-spec
        └─ CpqProductRelationship requires / excludes / parent_child between specs

CpqProductOffering         sellable instance of a spec — design-time defaults + price tables
        │
        └─ CpqOfferingComponent   for bundle offerings: which child offering fills which slot
```

## Canonical files

| Concern | File |
|---|---|
| Product service | [`src/modules/cpq/services/cpqProductService.ts`](../../../../src/modules/cpq/services/cpqProductService.ts) |
| Bundle service | [`src/modules/cpq/services/cpqBundleService.ts`](../../../../src/modules/cpq/services/cpqBundleService.ts) |
| Validation (used by both) | `services/cpqValidationService.ts` |
| Entities | `data/entities.ts` — `CpqProductSpecification`, `CpqProductOffering`, `CpqProductAttribute`, `CpqProductCharge`, `CpqProductRelationship`, `CpqBundleSlot`, `CpqOfferingComponent` |
| API routes | `api/product-specifications/`, `api/product-offerings/`, `api/product-attributes/`, `api/product-charges/`, `api/product-relationships/`, `api/bundle-slots/`, `api/bundle-tree/`, `api/offering-components/`, `api/attribute-options/` |
| Backend pages | `backend/cpq/specifications/`, `backend/cpq/offerings/` |

## Mandatory reading

1. [`specs/implementation/xd-187-product-specification.md`](../../../../specs/implementation/xd-187-product-specification.md) — spec/offering/attribute model
2. [`manuals/xd-223-bundled-offerings.md`](../../../../manuals/xd-223-bundled-offerings.md) + [`specs/implementation/xd-223-bundled-offerings.md`](../../../../specs/implementation/xd-223-bundled-offerings.md) — bundle slots/components

## Domain rules

- **Specification ≠ Offering.** A specification is the abstract blueprint;
  an offering is what a customer can actually buy. Multiple offerings can
  share a specification (different price tables, regional variants, etc.).
- **Attributes belong to the specification.** Their *values* live on the
  quote line (`CpqQuoteLineConfiguration.attributes`).
- **Charges belong to the offering.** Same migration enforced uniqueness:
  `Migration20260331000000_cpq_charge_unique_per_offering.ts`.
- **Relationships are spec-to-spec, not offering-to-offering.** `requires`
  / `excludes` / `parent_child` constrain which specs can co-exist on a
  quote.
- **Bundles** are specifications with `bundle_slots` defined. A bundle
  *offering* uses `cpq_offering_components` to pick concrete child
  offerings for each slot. The bundle tree API (`api/bundle-tree/`)
  exposes the resolved hierarchy for the UI.
- **No catalog ORM relations.** CPQ stores `catalog_product_id: string`,
  never `@ManyToOne(() => CatalogProduct)`. Joins happen via the query
  engine or via a Response Enricher when surfacing data in admin lists.

## Common tasks

### Add a new attribute type (e.g. multi-select)

1. Extend the type union on `CpqProductAttribute` (jsonb `config`).
2. Update validators in `data/validators.ts`.
3. Implement option-rendering in the configurator widget
   (`widgets/injection/quote-configurator/`).
4. If the new type affects pricing, route it through `cpqPricingService`.
5. Update the spec at `specs/implementation/xd-187-product-specification.md`.

### Add a new relationship kind

1. Extend the `kind` enum on `CpqProductRelationship`.
2. Implement the rule in `cpqValidationService` (the `validate-relationships`
   API path consumes it).
3. Surface the new kind in `backend/cpq/specifications/[id]/page.tsx`.

### Build a bundle offering with a new slot type

1. Define the slot on the parent specification (`CpqBundleSlot`).
2. Create child specifications (or reuse existing) and offerings.
3. Wire components in `cpq_offering_components` linking parent offering ↔
   child offering ↔ slot.
4. Verify `api/bundle-tree/` returns the expected hierarchy.

## Required detail pages

| Entity | List | Detail |
|---|---|---|
| `CpqProductSpecification` | [`backend/cpq/specifications/page.tsx`](../../../../src/modules/cpq/backend/cpq/specifications/page.tsx) | [`[id]/page.tsx`](../../../../src/modules/cpq/backend/cpq/specifications/[id]/page.tsx) — must show attributes, relationships, bundle slots in one place |
| `CpqProductOffering` | [`backend/cpq/offerings/page.tsx`](../../../../src/modules/cpq/backend/cpq/offerings/page.tsx) | [`[id]/page.tsx`](../../../../src/modules/cpq/backend/cpq/offerings/[id]/page.tsx) — must show charges + offering components for bundles |
| `CpqProductAttribute` | inline on spec detail | inline editor (no separate detail page needed) |
| `CpqProductRelationship` | inline on spec detail | inline editor |
| `CpqBundleSlot` | inline on spec detail | inline editor |
| `CpqOfferingComponent` | inline on offering detail | inline editor |

If you introduce a new product-domain entity, follow Engineering bar §3:
list + `[id]` detail. Inline editors on parent detail pages count only when
the child entity has no meaning standalone (attributes belong to a spec;
they make no sense outside it).

## Required tests

Place under `src/modules/cpq/services/__tests__/`:

| Test file | Asserts |
|---|---|
| `cpqProductService.test.ts` | Creating a spec auto-creates expected default attribute set; specs can be cloned; soft-delete preserves history |
| `cpqValidationService.relationships.test.ts` | `requires` enforces presence; `excludes` rejects co-existence; `parent_child` cycle detection rejects loops |
| `cpqBundleService.tree.test.ts` | `bundle-tree` resolves N-level bundles; missing component for a slot raises a documented error; capacity bounds enforced |
| `cpqBundleService.charges.test.ts` | Bundle aggregate charges = sum of child charges; uniqueness constraint per offering holds across rebuilds |
| `data/validators.products.test.ts` | Zod schemas for spec / offering / attribute round-trip from `manuals/xd-187-product-specification.md` examples |

## Self-review checklist

- [ ] OpenAPI updated for any product / spec / offering / bundle route
- [ ] Specs vs offerings vs attributes vs charges — placed each on the
      correct entity
- [ ] Cross-module FKs are strings, never relations
- [ ] Charge uniqueness per offering preserved
- [ ] Bundle slots/components validated — no orphan components, slot
      capacity respected
- [ ] Relationship enum updates flow into `cpqValidationService`
- [ ] User-facing strings translated
- [ ] Detail pages: list + `[id]` for every new spec / offering entity
- [ ] Unit tests cover product service, relationship validation, bundle
      resolution, and charge aggregation
- [ ] `yarn mercato db generate` after entity changes; `yarn generate`
      after structural changes
