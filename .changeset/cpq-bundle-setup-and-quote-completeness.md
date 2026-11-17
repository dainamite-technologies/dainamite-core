---
'@dainamite/cpq': minor
---

Bundles can be set up and quoted end to end (#122, #123, #124, #125).

- `POST /api/cpq/product-offerings`: `offeringType` is optional and defaults to the specification's `specType`. Sending a type that does not match still returns 400 `V-OFF-7`. The admin create forms show the type read-only.
- A bundle component that was removed can be added again. Migration `Migration20261117120000_cpq_offering_components_partial_unique` turns `cpq_off_comp_unique` into a partial unique index over live rows; run `yarn mercato db migrate`. `POST /api/cpq/offering-components` and `POST /api/cpq/bundle-slots` return 404 for an unknown offering, slot or specification and 409 `V-COMP-5` for a concurrent duplicate, instead of 500.
- `POST /api/cpq/quotes/{quoteId}/items` accepts `expandBundleDefaults: true`. For a bundle offering it adds each active default component as a child line (recursively, capped at each slot group's maximum). Without the flag nothing changes. The admin quote page, the wizard steps and the `cpq.add_quote_line` AI tool send it; the tool now also requires `cpq.offerings.view`.
- Quote-time bundle rules V-QBUN-1..3: a bundle line whose required slot group is short (or over its maximum) is incomplete and its error names the slot; a child line that is not a component of its bundle (and not a `parent_child` add-on) is flagged. `validationResult.errors` may contain `type: 'bundle_slot'` entries with `slotGroup` / `slotName`.
- **Behaviour change:** `POST /api/cpq/orders` returns 422 `BUNDLE_INCOMPLETE` (with the V-QBUN `errors`) for a quote whose stored validation has bundle-slot errors. Other invalid states convert as before.
- A valid line for an offering with no charge definitions (e.g. included equipment) is now configured. When an offering has charges but none applies, the line stays incomplete with `V-LINE-1` (`type: 'charge'`) instead of an unexplained "incomplete".
