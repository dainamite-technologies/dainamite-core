import {
  billingAccountCreateSchema,
  billingItemCreateSchema,
  billingSettingsUpdateSchema,
} from '@dainamite/billing/modules/billing/data/validators'
import { PAYMENT_CSV_HEADER, parsePaymentCsv } from '@dainamite/billing/modules/billing/lib/paymentCsv'
import { ACME_ACCOUNTS, ACME_BILLING_SETTINGS, acmeDate, buildAcmePaymentsCsv } from '../billing-data'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const anchor = new Date(Date.UTC(2026, 10, 18, 15, 30))
const header = PAYMENT_CSV_HEADER.join(',')

describe('acmeDate', () => {
  it('keeps the day and shifts whole months from the anchor month (UTC midnight)', () => {
    expect(acmeDate(anchor, { day: 5 }).toISOString()).toBe('2026-11-05T00:00:00.000Z')
    expect(acmeDate(anchor, { day: 1, month: 1 }).toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(acmeDate(new Date(Date.UTC(2027, 11, 3)), { day: 10, month: 1 }).toISOString()).toBe('2028-01-10T00:00:00.000Z')
  })
})

describe('ACME billing data', () => {
  it('settings pass the billing settings validator (IBAN / BIC / address / masks)', () => {
    const result = billingSettingsUpdateSchema.safeParse({ ...scope, ...ACME_BILLING_SETTINGS })
    expect(result.success ? [] : result.error.issues).toEqual([])
  })

  it.each(ACME_ACCOUNTS.map((a) => [a.key, a] as const))('%s: account and items pass the create validators', (_key, account) => {
    const accountResult = billingAccountCreateSchema.safeParse({
      ...scope,
      customerId: 'cust-1',
      customerKind: account.customerKind,
      name: account.customerName,
      currencyCode: account.currencyCode,
      billCycle: 'monthly',
      billCycleInterval: 1,
      billCycleDay: account.billCycleDay,
      nextBillDate: acmeDate(anchor, account.nextBillDate),
      invoiceEmail: account.invoiceEmail ?? 'billing+cust-1@invalid.local',
      invoiceAddress: account.invoiceAddress,
      billingMode: account.billingMode,
    })
    expect(accountResult.success ? [] : accountResult.error.issues).toEqual([])
    for (const item of account.items) {
      const itemResult = billingItemCreateSchema.safeParse({
        ...scope,
        billAccountId: '33333333-3333-4333-8333-333333333333',
        type: item.type,
        billStartDate: acmeDate(anchor, item.start),
        description: item.description,
        rateJson: item.rateJson,
        uomCode: item.uomCode,
        sourceRef: item.ref,
        taxRate: item.taxRate,
      })
      expect(itemResult.success ? [] : itemResult.error.issues).toEqual([])
    }
  })

  it('every step references an item / usage record of its own account', () => {
    for (const account of ACME_ACCOUNTS) {
      for (const step of account.steps) {
        if (step.kind === 'items') step.refs.forEach((ref) => expect(account.items.map((i) => i.ref)).toContain(ref))
        if (step.kind === 'usage') step.refs.forEach((ref) => expect(account.usage.map((u) => u.ref)).toContain(ref))
      }
    }
  })
})

describe('buildAcmePaymentsCsv', () => {
  const posted = {
    brightside: { number: 'INV/2026/11/000001', totalGross: '196.8000' },
    copperleaf: { number: 'INV/2026/11/000002', totalGross: '5500.0000' },
  }

  it('fills invoice numbers and amounts from the posted invoices', () => {
    const { content, rows } = buildAcmePaymentsCsv(header, '2026-11-18', posted)
    expect(content.split('\n').slice(0, 3)).toEqual([
      header,
      '2026-11-18,196.80,USD,Payment for INV/2026/11/000001,Brightside Solar,',
      '2026-11-18,2750.00,USD,INV/2026/11/000002 part 1,Copperleaf Design Co.,',
    ])
    expect(rows).toHaveLength(7)
    expect(rows.filter((r) => r.assignTo === 'brightside')).toHaveLength(3)
  })

  it('produces a file the billing CSV parser accepts without errors', () => {
    const parsed = parsePaymentCsv(buildAcmePaymentsCsv(header, '2026-11-18', posted).content)
    expect(parsed.fatal ?? null).toBeNull()
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(7)
  })

  it('drops rows that reference an account with no posted invoice', () => {
    const { rows } = buildAcmePaymentsCsv(header, '2026-11-18', { brightside: posted.brightside })
    expect(rows.map((r) => r.reference)).not.toContain('{copperleaf} part 1')
    expect(rows).toHaveLength(6)
  })
})
