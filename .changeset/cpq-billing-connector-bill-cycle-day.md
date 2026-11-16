---
'@dainamite/cpq-billing-connector': minor
---

Bill cycle day: follow `@dainamite/billing` 1.1 (peer range now `^1.1.0`; `@dainamite/cpq` `^1.0.1` for the activation guard).

- **New accounts are created with `billCycle` + `billCycleInterval` + `billCycleDay`** instead of `billCycleAnchor`. Default: every 1 month on day 1. `quarterly` is gone; a legacy `quarterly` in an upstream payload is read as monthly × 3, and an invalid upstream combination falls back to the unit's defaults instead of failing onboarding.
- **`nextBillDate` is sent only when the operator or upstream set one.** Otherwise billing starts the account on the first bill cycle day on or after today. The connector no longer derives it from the earliest line bill start or the activation date; recurring items that start later produce empty cycles until their bill start.
- **Order setup.** The free-text "Bill cycle anchor" input is replaced by "Every [N] [unit] on [day]" controls (1–31 for months / years, a weekday for weeks, hidden for days). "First bill date" is optional. Saved `accountOverrides` take `billCycleInterval` / `billCycleDay` (validated against the unit); `billCycleAnchor` is rejected.
