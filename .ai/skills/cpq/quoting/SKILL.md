---
name: cpq-quoting
description: Quote lifecycle work — creating, editing, recalculating, cloning, and validating quotes; quote line configurations; quote attributes; wizard definitions and the multi-step guided configurator. Load when changing the `cpq_quote_*` tables, `cpq_wizard_definitions`, the configurator UI, or the quote API surface.
---

# CPQ — Quoting & Wizards

## Canonical files

| Concern | File |
|---|---|
| Quoting service (the brain) | [`src/modules/cpq/services/cpqQuotingService.ts`](../../../../src/modules/cpq/services/cpqQuotingService.ts) (~1.2KLOC) |
| Wizard service | [`src/modules/cpq/services/cpqWizardService.ts`](../../../../src/modules/cpq/services/cpqWizardService.ts) |
| Validation service | [`src/modules/cpq/services/cpqValidationService.ts`](../../../../src/modules/cpq/services/cpqValidationService.ts) |
| Quote entities | `data/entities.ts` — `CpqQuoteConfiguration`, `CpqQuoteLineConfiguration`, `CpqWizardDefinition` |
| Quote APIs | `api/quotes/*` (CRUD, items, recalculate, status, clone, attributes, validate-relationships, price) |
| Wizard APIs | `api/wizards/*` (incl. `wizards/resolve`) |
| Quote backend UI | `backend/cpq/quotes/`, `backend/cpq/wizards/` |
| Wizard runner / engine | `workflows/WizardRunner.tsx`, `workflows/engine.tsx`, `workflows/registry.ts`, `workflows/steps/` |
| Quote configurator widget (in sales quote) | `widgets/injection/quote-configurator/` |
| Wizard seed data | `lib/seeds.ts` (e.g. GIX wizard) |
| Service types | `services/types.ts` — `CreateQuoteInput`, `QuoteItemInput`, `QuoteLineResult`, `QuoteResult`, `ValidationError` |

## Mandatory reading

1. [`specs/implementation/xd-201-quoting.md`](../../../../specs/implementation/xd-201-quoting.md) — long-form quote lifecycle spec
2. [`manuals/xd-188-quote-wizard-with-price-rules.md`](../../../../manuals/xd-188-quote-wizard-with-price-rules.md) — wizard UX
3. [`specs/implementation/xd-202-workflow.md`](../../../../specs/implementation/xd-202-workflow.md) — wizard engine internals

## Domain rules

- **Quote = sales.Quote + CpqQuoteConfiguration.** CPQ does not own the quote
  header — it owns *configuration data attached to* a sales quote (FK
  `quote_id`). The sales module remains the source of truth for status,
  totals, and customer ownership.
- **Quote lines mirror sales lines 1:1.** `CpqQuoteLineConfiguration.line_id`
  references `sales_quote_lines.id`. CPQ adds the offering, attribute values,
  and pricing breakdown.
- **Document numbering** comes from `salesDocumentNumberGenerator` — already
  injected into `cpqQuotingService` via DI. Don't reinvent.
- **Wizards are data-driven.** A `CpqWizardDefinition` declares steps with
  `type` (e.g. `customer_select`, `product_configure`), `config`, and
  `transitions` (conditional). Step kinds are registered in
  `workflows/registry.ts`.
- **Recalculation is destructive of the breakdown but not of the lines.**
  `recalculate` re-resolves prices/rules using current config, then writes
  new `pricing_summary` jsonb on each line. Existing item ids stay stable.
- **`validate-relationships`** checks that selected offerings respect
  `CpqProductRelationship` constraints (requires/excludes) before save.

## Common tasks

### Add a new wizard step type

1. Add the step kind to `workflows/types.ts` and register a renderer in
   `workflows/registry.ts`.
2. Implement the step's runtime in `workflows/steps/<step>/`.
3. Extend `cpqWizardService` if the step needs server-side resolution (call
   path: `api/wizards/resolve`).
4. Update `lib/seeds.ts` with an example.
5. Document in `manuals/xd-188-quote-wizard-with-price-rules.md`.

### Add a new quote-line attribute that affects pricing

1. Capture it in `CpqQuoteLineConfiguration.attributes` jsonb (no schema
   change needed).
2. Make sure the matcher in `cpqPricingService` reads it (extend the match
   tuple if it's a new pricing dimension — see `pricing/SKILL.md`).
3. Add a UI control in `widgets/injection/quote-configurator/`.

### Clone a quote

`api/quotes/[quoteId]/clone/route.ts` — clones sales header via the sales
module **and** clones the CPQ configuration rows. If you add new CPQ
quote-related entities, extend the clone path to copy them too. Forgetting
this is a classic source of "the cloned quote is missing X" bugs.

## Anti-patterns to flag in review

- Mutating `sales_quotes` directly from CPQ — go through the sales module.
- Reading `sales_quote_lines.unit_price` and writing back from CPQ — pricing
  flows through `cpqPricingService`, which then surfaces the result in the
  CPQ line config; the sales module reads it back via Response Enricher.
- Hardcoded wizard step strings — always go through `workflows/registry.ts`.

## Self-review checklist

- [ ] Quote header changes go through sales-module commands, not direct
      MikroORM writes.
- [ ] `CpqQuoteLineConfiguration` is updated within a `withAtomicFlush` block
      if the same EM is reused for queries afterwards.
- [ ] Cloning logic copies *all* CPQ-side rows tied to the source quote.
- [ ] New wizard step types are registered in `workflows/registry.ts`.
- [ ] Validation errors use the `ValidationError` shape from `services/types.ts`.
- [ ] User-facing strings translated; wizard step labels go through `useT()`.
- [ ] `yarn generate` re-run after editing `events.ts`, `acl.ts`, or any
      auto-discovered file.
