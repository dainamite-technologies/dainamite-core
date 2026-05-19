# @dainamite/cpq-billing-connector

## 0.1.0 — Initial release (unreleased)

- 6 subscribers translating CPQ subscription lifecycle events to
  `@dainamite/billing` command-bus calls:
  - `cpq.subscription.activated` *(awaits CPQ upstream PR)* → create
    Billing Account if missing, create Billing Items per charge.
  - `cpq.subscription.amended` → add new items, set `bill_end_date`
    on removed items, post the proration `one_time` Item the
    connector computes here.
  - `cpq.subscription.renewed` → extend `bill_end_date` + add any
    new items.
  - `cpq.subscription.cancelled` → set `bill_end_date` on every item
    for the cancelled subscription.
  - `cpq.subscription.merged` → re-link items from source
    subscriptions to the merged target.
  - `cpq.subscription.superseded` → set `bill_end_date` on every
    item for the superseded subscription.
- Pure helpers:
  - `lib/prorationHelper.ts` — `unitPrice × quantity × daysRemaining
    / daysInPeriod` with half-up 2dp rounding, matching the spec's
    invoice-amount rounding policy. Proration math lives here (not
    in CPQ) so CPQ stays neutral on billing calendar semantics.
  - `lib/chargeMapper.ts` — CPQ charge → billing item create payload.
- `lib/billingApiClient.ts` — internal commandBus wrapper. Subscribers
  go through the same command IDs that the billing REST routes
  use — `billing.accounts.create`, `billing.items.create`, etc. — so
  there is only one write path for billing state.
- Module ID: `cpq_billing_connector` (plural-ish-snake-case, matches
  OM's `auth` / `customers` / `dictionaries` convention).
