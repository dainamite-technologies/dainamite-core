import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { listCpqUseCases } from '@dainamite/cpq/modules/cpq/lib/seeds/api'
import { loadExampleCustomerIds } from './seeds/customers'
import { seedAcmeCpq } from './seeds/cpq'
import { ACME_MARKER_SKU } from './seeds/cpq-data'
import { seedAcmeBilling } from './seeds/billing'

/**
 * Example data for the primary (ACME) tenant created by `mercato init`:
 * CPQ catalog + a quote → order → subscription for Brightside Solar, then
 * the billing session (accounts, runs, invoices, payments, prepaid).
 *
 * The demo_tenants runner replays every module's `seedExamples` into each
 * demo use-case tenant (GIX, Puffin, …), so this hook skips organizations
 * that belong to a registered use case — ACME data stays in ACME.
 *
 * All-or-nothing: skipped when the demo catalog already exists (a second
 * replay would duplicate quotes, orders and posted invoices).
 *
 * Must be registered after `customers`, `cpq`, `billing` and
 * `cpq_billing_connector`, and before `demo_tenants` in `src/modules.ts`.
 */
export const setup: ModuleSetupConfig = {
  async seedExamples({ em: rawEm, container, tenantId, organizationId }) {
    const em = rawEm as EntityManager
    const scope = { tenantId, organizationId }
    const org = await em.findOne(Organization, { id: organizationId } as never)
    const demoOrgNames = new Set(listCpqUseCases().map((u) => u.tenant.organizationName).filter(Boolean))
    if (org && demoOrgNames.has(org.name)) return

    if (await em.findOne(CatalogProduct, { ...scope, sku: ACME_MARKER_SKU, deletedAt: null } as never)) {
      console.log('[demo_acme] skipped: ACME demo data already present')
      return
    }

    const customerIds = await loadExampleCustomerIds(em, scope)

    const cpq = await seedAcmeCpq(em, container, scope, customerIds)
    console.log(
      `[demo_acme] cpq seeded: offerings=${cpq.offerings} quotes=${cpq.quoteNumbers.join(', ') || '-'} ` +
        `order=${cpq.orderNumber ?? '-'} subscription=${cpq.subscriptionId ?? '-'}`,
    )

    const billing = await seedAcmeBilling(em, container, scope, customerIds, {
      cpqAccountIds: { brightside: cpq.billingAccountId },
    })
    if (billing.skipped) {
      console.log(`[demo_acme] billing seed skipped: ${billing.reason}`)
      return
    }
    console.log(
      `[demo_acme] billing seeded: accounts=${billing.accounts.join(', ')} posted=${billing.posted.join(', ') || '-'} payments=${billing.payments}` +
        (billing.missingCustomers.length ? ` (customers not found: ${billing.missingCustomers.join(', ')})` : ''),
    )
  },
}

export default setup
