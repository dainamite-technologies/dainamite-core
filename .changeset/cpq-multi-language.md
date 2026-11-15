---
'@dainamite/cpq': minor
---

CPQ UI in English, Spanish, German and Polish.

- **Dictionaries.** New `i18n/{en,es,de,pl}.json` (1218 keys). CPQ previously shipped no dictionaries, so every screen rendered English in every locale.
- **Every UI string is translatable.** Hard-coded labels in quotes, orders, the quote wizard, specifications, offerings, inventory, price rules, pricing tables, wizard definitions, shared components and the injected widgets now go through `t()`. English text is unchanged.
- **Own generic labels.** `cpq.common.*` replaces borrowed `common.*` keys that only some unrelated modules shipped (`common.inactive` existed nowhere).
- **Sales tabs translated.** The quote / order tabs on sales documents use i18n keys as `groupLabel`. The customer "Inventory" tab stays English (legacy customer pages render `groupLabel` verbatim).
- **Row-action messages are noun-free** (`Delete selected items ({count})?`), because a spliced entity noun can't be grammatical in ES / DE / PL. `useCpqRowActions({ entityName })` is now optional and deprecated.
- **API change for direct importers:** `parsePricingTableXlsx` / `commitImportDiff` take a required `t` argument, and `StatusPath`'s `ariaLabel` is optional.
- **Guardrails:** tests fail on a missing or orphaned key, a dropped `{placeholder}`, or a new hard-coded UI string.

No migration. After upgrading run `yarn generate` so the app picks up the dictionaries.
