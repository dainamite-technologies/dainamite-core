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
