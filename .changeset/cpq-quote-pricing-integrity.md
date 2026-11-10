---
"@dainamite/cpq": minor
---

Harden quote pricing ahead of manual price adjustments.

- `POST /api/cpq/quotes/{quoteId}/recalculate` now requires `cpq.quotes.manage`
  (was `cpq.quotes.view`), and a saved recalculation (`save: true`) on an
  accepted, rejected or cancelled quote returns `409`. Integrations that
  recalculate with a view-only API key must be granted `cpq.quotes.manage`.
- Amend quotes no longer re-price items the operator does not touch: mirror
  lines keep the subscription's stored price until their configuration,
  quantity, term, dates or usage estimates change.
- Status transitions, line add / update / remove, saved recalculations and
  quote-to-order conversion run every registered mutation guard
  (resource kinds `cpq.quote` and `cpq.quote_line`), so projects can enforce
  approvals. No behaviour change when no guard is registered.
