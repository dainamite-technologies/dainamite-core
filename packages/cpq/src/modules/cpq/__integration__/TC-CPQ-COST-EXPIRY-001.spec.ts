import { test } from '@playwright/test'

/**
 * TC-CPQ-COST-EXPIRY-001 — supplier cost expiry warnings (feature spec 2026-11-12-cpq-cost-plus-index-costs-expiry, step 18)
 *
 * Intended flow: a quote with a confirmed price-basis cost whose `valid_until` is within the lead days; run
 * `yarn mercato cpq run-cost-expiry --today <date>` in a non-production environment; exactly one `cpq.cost.expiring`
 * notification lands in the cost manager's inbox (`/api/notifications`); a second run adds none.
 *
 * `test.fixme`: the scan is driven only by the scheduled `cpq-cost-expiry` worker or the CLI, and the Playwright
 * harness (`@open-mercato/core/helpers/integration/*`, API + browser only) cannot invoke a CLI or tick the scheduler;
 * the spec defines no HTTP trigger for it (an API would let any caller write ledger rows). The same behaviour is
 * frozen in unit tests: `services/costs/__tests__/costExpiryService.test.ts` (once per line and date over two runs, one
 * notification), `__tests__/cli.test.ts` and `workers/__tests__/cost-expiry.worker.test.ts`.
 */
test.describe('TC-CPQ-COST-EXPIRY-001: run-cost-expiry notifies the cost manager once', () => {
  test.fixme('one notification after the first run, none after the second (needs a CLI hook in the harness)', async () => {
    // Steps once a CLI hook exists: create fixtures through the API (as TC-CPQ-COST-SOURCING-001), switch `cpq.cost_plus` on,
    // `mercato cpq run-cost-expiry --org <id> --today <valid_until - 7d>`, list notifications as the manager, run again, compare.
  })
})
