# Notify — 2026-11-15-cpq-cost-plus-foreign-currency-costs

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-15T09:54:48Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-foreign-currency-costs.md (App Spec cost-plus, feature 4 of 6), stacked on PR #95.
- Decision: step 9 stays in this PR (its dependency, PR #94, is in the branch history).
- Decision: the upstream UP-FX-1 issue is drafted in the run folder, not filed (outward-facing; a human files it).
- Decision (step 6): the answered status of a PR #95 supplier answer / manual foreign value stored as `none` + CURRENCY_NO_RATE is not kept anywhere, so on rate arrival it becomes `estimated` with the note "Rate applied after entry." (spec Q13, reversible: a pricing manager confirms). A mirror / carried line holding a snapshot keeps it; one without a snapshot (new line, or no-rate line) is resolved like any other.

## 2026-11-15T10:13:14Z — main session: amounts and currencies (for step 9)
- As built in step 6: quote cost `unit_amount` / `instance_amount` stay in the cost currency; `fx_rate` is applied when costs are summed (list price, margin). Feature 2 Q3 requires order line / inventory cost `total_amount` in the document (subscription) currency, and item / asset margins (itemMargin.ts) subtract it from item amounts — so step 9 must compute `total_amount = instance × qty × fx_rate` (rounded once) when an fx_rate is set, keep unit / instance in the cost currency, and copy all four fx_* fields verbatim. `costLineTotal` must therefore take the rate.

## 2026-11-15T10:45:00Z — step 7 decisions
- Manual create / value edit resolves the rate in the write itself (unlocked and locked alike) when the value is new or changed (a currency change counts); a same-value confirmation or a note-only edit keeps the stored snapshot; no rate -> `none` + CURRENCY_NO_RATE with the entered amount / currency kept and `value_origin = manual`. The unlocked saved recalculation then refreshes it as usual (step 6).
- A note-only PATCH of a stored `none` + CURRENCY_NO_RATE line no longer fails with FIELD_NOT_ALLOWED: the line is left as it is.
- PR #95 supplier answers (`valuePatch`) resolve the rate in the same write and keep the answered status; no rate keeps the PR #95 shape. Locked-quote comparison already ran in the cost's own currency plus currency code (`classifyAnswer`), so it is unchanged: a different currency is a proposal.

## 2026-11-15T11:00:00Z — step 8 decisions
- `error` stays the string code on every cost projection (CostsPanel and the PR #93 clients read it as a string), so the spec's `error: {code, from, to, date}` is delivered as an additive `errorDetail` (cost.view holders only; redacted views and the write-route whitelist never carry it). Reversible: step 10 reads `errorDetail`.
- `missingFxPairs` is one grouped raw-SQL query (`cpq_quote_line_costs` x `cpq_quote_configurations`, NOT EXISTS order), ordered by open-quote count desc; no ORM relation spans the two entities.

## 2026-11-15T11:30:00Z — step 9 decisions
- `costLineTotal` now takes `fxRate`: `total_amount = round4(instance x qty x fx_rate)` (rate omitted when unset), one rounding; unit / instance / currency stay in the cost currency, all four `fx_*` fields are copied verbatim, no resolver call at conversion or activation. A foreign cost with no rate is `none` and so has a null total.
- Snapshot cost shape always includes `fxRateSource` / `fxRateDerivation` (null when unset), like the existing `fxRate` / `fxRateDate`; the pricing golden and subscription event payload golden stay green (costs are not in the event payloads).

## 2026-11-15T12:00:00Z — step 10 decisions
- The dialog's rate hint needs a pair rate, which `cost-preview` (offering-based) could not answer. Additive extension: `cost-preview` accepts `fxFrom` (3-letter cost currency; with it, offeringId / productId become optional) and answers `fxHint` ({from, to, fxRate*, or error + errorDetail}). Nothing stored; same route features. The client skips the call without cpq.pricing.view + cpq.costs.view and ignores any failure silently.
- "(looked back N days)" is rendered only when a look-back is passed; no read API exposes the tenant look-back, so the badge reads "No USD→EUR rate for 2026-11-12".
- Not done: the "Missing exchange rates: USD→EUR (N open quotes)" operator line — no UI consumes `cost-plus/usage` beyond `enabled` (no toggle-off confirmation exists to extend).
- Order / subscription / asset rows: the value is `totalAmount` in the document currency when a rate applies (it was previously formatted in the cost currency), with a note "from 300.00 USD · 0.92 · ECB · date".

## 2026-11-15T12:30:00Z — step 11 decisions
- UP-FX-1 is NOT filed (outward-facing). The full issue text is drafted in `UP-FX-1-issue.md` in this run folder; the manual and `packages/cpq/MIGRATION.md` reference it as "to be filed — draft in the run folder". A human files it and replaces the reference with the issue link.
- Demo: a dedicated EUR offering ("GIX IP Transit with USD partner tail (EUR)", one fixed 300 USD price-basis element) instead of changing the existing USD IP Transit offering (its quotes are USD, so a USD tail would not convert, and existing tenants would not receive an element edit). Rates are written straight to the framework `ExchangeRate` entity (no public write service exists; demo_gix is L3), idempotent per pair / UTC day / source `Manual`.
- E2E (`TC-CPQ-COST-FX-001`) cannot run locally. Rate sources are named `0e2efx-*` so they sort before any real source under the resolver's tie-break (no priority list), making the newer-rate steps deterministic.
- 2026-11-15 review1-a: no-rate entered values null instanceAmount; transient resolver error keeps snapshot; confirmed_unchanged never promotes a snapshot-less foreign row; zero-quantity fallback cost needs no rate
- 2026-11-15 review1-b: missingFxPairs counts only unlocked (new/incomplete/ready) quotes via ADJUSTMENT_MUTABLE_STATUSES; manual updated
- 2026-11-15 review1-c: CostsPanel per_unit rows show the converted unit amount then the instance total (pure formatConverted helper)
- 2026-11-15 review1-d: snapshotNote shows the cost-currency line total (totalAmount / fxRate), falling back to the instance amount
