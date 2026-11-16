import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingAccount, BillingItem, BillingAccountUsage } from '../../data/entities'
import type { CustomerKind } from '../../data/validators'
import type { InvoiceLanguageCode } from '../invoiceLanguages'
import { DEFAULT_DEMO_SELLER, applySellerDefaults } from './sellerSettings'

/**
 * Self-contained billing test-data seed.
 *
 * Creates a couple of demo billing accounts with recurring + usage items
 * and one unrated usage record, scoped to a single tenant. Everything is
 * idempotent: accounts are matched by name, items/usage by `source_ref`,
 * so re-running is a no-op rather than a duplicate.
 *
 * The accounts are dated so they are immediately billable: `next_bill_date`
 * is the 1st of the current month. A Bill Run with the default (today's)
 * as-of date then shows every Spec A behaviour on one invoice per account:
 *   - recurring items billed IN ADVANCE for this month (the default);
 *   - Globex's in-arrears item billed for last month;
 *   - Northwind's mid-cycle add-on: a prorated stub for the second half of
 *     last month plus this month;
 *   - usage (always in arrears) for last month.
 *
 * Drives `mercato billing seed`. Kept free of any customer-specific data so
 * it ships with `@dainamite/billing`.
 */

export type BillingDemoScope = { tenantId: string; organizationId: string }
export type BillingDemoResult = {
  accountsCreated: number
  itemsCreated: number
  usageCreated: number
}

// Shared prefix for every row this seed owns — the reset path keys off it.
const SRC = 'demo-billing'
const ACCOUNT_NAME_PREFIX = 'Demo — '

type DemoAccountSpec = {
  name: string
  customerId: string
  // Spec E: 'person' = a B2C account. Omitted → 'company'.
  customerKind?: CustomerKind
  currencyCode: string
  invoiceLanguage: InvoiceLanguageCode
}

type DemoItemSpec = {
  ref: string
  type: 'recurring' | 'usage'
  description: string
  unitPrice: number
  uomCode?: string
  // Spec B: VAT %. Default 23 (PL standard rate).
  taxRate?: string
  // Spec A. Default 'in_advance'.
  chargeTiming?: 'in_advance' | 'in_arrears'
  // Spec F. Default 'net'. Consumer (B2C) prices are quoted gross.
  priceBasis?: 'net' | 'gross'
  // When the item starts, relative to the seeded bill date:
  //   'billDate' (default) — 1st of this month, billed in advance from day one;
  //   'prevMonth'          — 1st of last month (in-arrears items bill it now);
  //   'prevMonthMid'       — 15th of last month: an add-on bought mid-cycle,
  //                          so the first run shows a prorated stub line.
  start?: 'billDate' | 'prevMonth' | 'prevMonthMid'
}

type DemoUsageSpec = {
  ref: string
  uomCode: string
  quantity: number
  lineDescription: string
}

const ACCOUNTS: Array<{
  account: DemoAccountSpec
  items: DemoItemSpec[]
  usage: DemoUsageSpec[]
}> = [
  {
    account: {
      name: `${ACCOUNT_NAME_PREFIX}Northwind Telecom`,
      customerId: 'demo-cust-northwind',
      currencyCode: 'PLN',
      invoiceLanguage: 'en',
    },
    items: [
      { ref: `${SRC}-nw-rec`, type: 'recurring', description: 'Platform subscription (monthly)', unitPrice: 199 },
      {
        ref: `${SRC}-nw-addon`,
        type: 'recurring',
        description: 'Priority support add-on (monthly)',
        unitPrice: 60,
        taxRate: '8',
        start: 'prevMonthMid',
      },
      { ref: `${SRC}-nw-usg`, type: 'usage', description: 'Data transfer (per GB)', unitPrice: 0.5, uomCode: 'gb', start: 'prevMonth' },
    ],
    usage: [
      { ref: `${SRC}-nw-usage`, uomCode: 'gb', quantity: 120, lineDescription: 'Data transfer (prev. month)' },
    ],
  },
  {
    account: {
      name: `${ACCOUNT_NAME_PREFIX}Globex Cloud`,
      customerId: 'demo-cust-globex',
      currencyCode: 'EUR',
      invoiceLanguage: 'en',
    },
    items: [
      { ref: `${SRC}-gx-rec`, type: 'recurring', description: 'Cloud plan (monthly)', unitPrice: 49 },
      {
        ref: `${SRC}-gx-arr`,
        type: 'recurring',
        description: 'Managed backups (billed in arrears)',
        unitPrice: 15,
        // 0 % — shows a mixed-rate VAT summary on the document.
        taxRate: '0',
        chargeTiming: 'in_arrears',
        start: 'prevMonth',
      },
    ],
    usage: [],
  },
  {
    // B2C: a private person on a flat monthly internet plan, invoiced in Polish.
    account: {
      name: `${ACCOUNT_NAME_PREFIX}Jan Kowalski`,
      customerId: 'demo-cust-jan-kowalski',
      customerKind: 'person',
      currencyCode: 'PLN',
      invoiceLanguage: 'pl',
    },
    items: [
      // B2C price quoted gross (79.00 PLN incl. 23 % VAT) — Spec F, F-D2.
      {
        ref: `${SRC}-jk-rec`,
        type: 'recurring',
        description: 'Internet 300 Mb/s (miesięcznie)',
        unitPrice: 79,
        priceBasis: 'gross',
      },
    ],
    usage: [],
  },
]


/** Delete every row this seed owns within the scope (reset before re-seed). */
export async function resetBillingDemo(em: EntityManager, scope: BillingDemoScope): Promise<void> {
  await em.nativeDelete(BillingAccountUsage, {
    ...scope,
    sourceRef: { $like: `${SRC}-%` },
  } as never)
  await em.nativeDelete(BillingItem, {
    ...scope,
    sourceRef: { $like: `${SRC}-%` },
  } as never)
  await em.nativeDelete(BillingAccount, {
    ...scope,
    name: { $like: `${ACCOUNT_NAME_PREFIX}%` },
  } as never)
}

export async function seedBillingDemo(
  em: EntityManager,
  scope: BillingDemoScope,
  options: { reset?: boolean; now?: Date } = {},
): Promise<BillingDemoResult> {
  if (options.reset) await resetBillingDemo(em, scope)

  const now = options.now ?? new Date()
  // Bill period the next run will cover, given next_bill = 1st of this month:
  //   periodStart = 1st of previous month, periodEnd = last day of previous month.
  // Build at UTC midnight so `date` columns don't drift a day under a positive
  // local UTC offset (local `new Date(y, m, 1)` would persist as the prev day).
  const nextBillDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const prevMonthMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))
  const startFor = (item: DemoItemSpec): Date =>
    item.start === 'prevMonth' ? prevMonthStart : item.start === 'prevMonthMid' ? prevMonthMid : nextBillDate

  const result: BillingDemoResult = { accountsCreated: 0, itemsCreated: 0, usageCreated: 0 }

  // ── Seller settings (Spec B: posting needs them). Only empty fields are
  // filled, so an operator's real details are never overwritten. ──
  await applySellerDefaults(em, scope, DEFAULT_DEMO_SELLER)

  for (const spec of ACCOUNTS) {
    // ── Account (idempotent by name within scope) ──
    let account = await em.findOne(BillingAccount, {
      ...scope,
      name: spec.account.name,
      deletedAt: null,
    } as never)
    if (!account) {
      account = em.create(BillingAccount, {
        ...scope,
        customerId: spec.account.customerId,
        customerKind: spec.account.customerKind ?? 'company',
        name: spec.account.name,
        currencyCode: spec.account.currencyCode,
        billCycle: 'monthly',
        billCycleDay: '1',
        invoiceEmail: `billing@${spec.account.customerId}.demo`,
        invoiceLanguage: spec.account.invoiceLanguage,
        taxId: null,
        invoiceAddress: { line1: 'ul. Demo 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
        nextBillDate,
        lastBillDate: null,
        isActive: true,
      })
      em.persist(account)
      await em.flush() // need the id for child rows
      result.accountsCreated += 1
    }

    // ── Items (idempotent by source_ref) ──
    for (const item of spec.items) {
      const existing = await em.findOne(BillingItem, { ...scope, sourceRef: item.ref } as never)
      if (existing) continue
      em.persist(
        em.create(BillingItem, {
          ...scope,
          billAccountId: account.id,
          type: item.type,
          billStartDate: startFor(item),
          billEndDate: null,
          chargeTiming: item.chargeTiming ?? 'in_advance',
          prorate: true,
          taxRate: item.taxRate ?? '23',
          priceBasis: item.priceBasis ?? 'net',
          description: item.description,
          rateJson: { unit_price: item.unitPrice },
          uomCode: item.uomCode ?? null,
          subscriptionId: null,
          subscriptionItemId: null,
          sourceRef: item.ref,
          currencyMismatch: false,
          billedToDate: null,
          isActive: true,
        }),
      )
      result.itemsCreated += 1
    }

    // ── Usage records (idempotent by source_ref) ──
    for (const u of spec.usage) {
      const existing = await em.findOne(BillingAccountUsage, { ...scope, sourceRef: u.ref } as never)
      if (existing) continue
      em.persist(
        em.create(BillingAccountUsage, {
          ...scope,
          billAccountId: account.id,
          uomCode: u.uomCode,
          quantity: u.quantity.toFixed(4),
          periodStart: prevMonthStart,
          periodEnd: prevMonthEnd,
          lineDescription: u.lineDescription,
          sourceRef: u.ref,
          ratedInBillRunId: null,
          isActive: true,
        }),
      )
      result.usageCreated += 1
    }
  }

  await em.flush()
  return result
}
