---
'@dainamite/cpq-billing-connector': patch
---

Order billing setup: follow-ups from the PR review.

- **Concurrent saves no longer fail with a 500.** When two requests create an order's billing setup at the same time, the loser hits the unique index and now retries once: it finds the winner's row and updates it (PUT replaces the whole setup, so the last writer wins). The activation lock (`markApplied`) retries the same way and keeps the first `appliedAt`.
- **A saved account that is no longer usable is flagged.** If the account saved for an order was deactivated, deleted, or no longer matches the customer and currency, the Billing tab shows a warning and re-derives the account choice (one candidate → preselected, none → create new, several → pick one) instead of re-submitting a selection the API rejects with 422. Saved bill start dates are kept. Activation already falls back safely when nobody re-saves.
