import { buildVatSummary, resolvePrepaidDebit } from '../../lib/prepaidTaxPoint'
import { receiptTaxRate } from '../../lib/billingSettings'
import { consumePrepaidUsage } from '../../lib/prepaidConsume'
import { createPrepaidMockEm } from '../helpers/prepaidMockEm'

describe('resolvePrepaidDebit (Spec F, F-D3)', () => {
  it('topup: debits the amount as entered — rate and basis ignored', () => {
    expect(resolvePrepaidDebit({ lineAmount: 49, priceBasis: 'net', taxRate: 23, taxPoint: 'topup' })).toEqual({
      debit: 49,
      net: 49,
      tax: 0,
      taxRate: 0,
    })
    expect(resolvePrepaidDebit({ lineAmount: '12.30', priceBasis: 'gross', taxRate: 23, taxPoint: 'topup' }).debit).toBe(12.3)
  })

  it('consumption: debits the gross — 20 @ 0 % → 20, 10 net @ 23 % → 12.30', () => {
    expect(resolvePrepaidDebit({ lineAmount: 20, priceBasis: 'net', taxRate: 0, taxPoint: 'consumption' }).debit).toBe(20)
    expect(resolvePrepaidDebit({ lineAmount: 10, priceBasis: 'net', taxRate: 23, taxPoint: 'consumption' })).toEqual({
      debit: 12.3,
      net: 10,
      tax: 2.3,
      taxRate: 23,
    })
  })

  it('consumption: a gross price is debited as typed; credits keep their sign', () => {
    expect(resolvePrepaidDebit({ lineAmount: 12.3, priceBasis: 'gross', taxRate: 23, taxPoint: 'consumption' }).debit).toBe(12.3)
    expect(resolvePrepaidDebit({ lineAmount: -10, priceBasis: 'net', taxRate: 23, taxPoint: 'consumption' }).debit).toBe(-12.3)
  })
})

describe('buildVatSummary', () => {
  it('groups consumption debits by rate (highest first) and is empty in topup mode', () => {
    const debits = [
      resolvePrepaidDebit({ lineAmount: 10, priceBasis: 'net', taxRate: 23, taxPoint: 'consumption' }),
      resolvePrepaidDebit({ lineAmount: 5, priceBasis: 'net', taxRate: 23, taxPoint: 'consumption' }),
      resolvePrepaidDebit({ lineAmount: 20, priceBasis: 'net', taxRate: 0, taxPoint: 'consumption' }),
    ]
    expect(buildVatSummary(debits, 'consumption')).toEqual([
      { rate: '23', net: '15.0000', tax: '3.4500', gross: '18.4500' },
      { rate: '0', net: '20.0000', tax: '0.0000', gross: '20.0000' },
    ])
    expect(buildVatSummary(debits, 'topup')).toEqual([])
  })
})

describe('receiptTaxRate (Spec F, P-D11)', () => {
  it('uses the top-up rate only when tax is charged at top-up — never twice', () => {
    expect(receiptTaxRate({ topupTaxRate: '23', prepaidTaxPoint: 'topup' })).toBe(23)
    expect(receiptTaxRate({ topupTaxRate: '23', prepaidTaxPoint: 'consumption' })).toBe(0)
    expect(receiptTaxRate({ topupTaxRate: 'x', prepaidTaxPoint: 'topup' })).toBe(0)
  })
})

describe('consumePrepaidUsage — tax point', () => {
  const TENANT = 'ten-1'
  const ORG = 'org-1'
  const ACCT = 'acct-1'
  const account = { id: ACCT, tenantId: TENANT, organizationId: ORG, currencyCode: 'EUR', billingMode: 'prepaid', creditLimit: '0' }
  const usageItem = (overrides: Record<string, unknown> = {}) => ({
    id: 'item-usage',
    type: 'usage',
    uomCode: 'gb',
    isActive: true,
    deletedAt: null,
    taxRate: '23',
    priceBasis: 'net',
    rateJson: { unit_price: 1 },
    description: 'Data',
    ...overrides,
  })
  const input = {
    organizationId: ORG,
    tenantId: TENANT,
    billAccountId: ACCT,
    uomCode: 'gb',
    quantity: 10,
    periodStart: new Date('2026-11-01'),
    periodEnd: new Date('2026-11-30'),
  }

  it('topup mode: debits the rated amount', async () => {
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '100.0000' },
      usageItem: usageItem(),
    })
    const { result } = await consumePrepaidUsage(em as never, account as never, input)
    expect(result.ratedAmount).toBe('10.0000')
    expect(result.balance).toBe('90.0000')
  })

  it('consumption mode: debits the gross (10 × 1.00 net @ 23 % → 12.30) and records the split', async () => {
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '100.0000' },
      usageItem: usageItem(),
      configs: { 'prepaid.tax_point': 'consumption' },
    })
    const { result } = await consumePrepaidUsage(em as never, account as never, input)
    expect(result.ratedAmount).toBe('12.3000')
    expect(result.balance).toBe('87.7000')
    const txn = em.transactions.find((t) => t.type === 'usage')!
    expect(txn.metadata).toMatchObject({ rated_amount: '10.0000', net: '10.0000', tax: '2.3000', tax_rate: '23', tax_point: 'consumption' })
  })

  it('consumption mode at 0 %: net = gross', async () => {
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '100.0000' },
      usageItem: usageItem({ taxRate: '0' }),
      configs: { 'prepaid.tax_point': 'consumption' },
    })
    const { result } = await consumePrepaidUsage(em as never, account as never, input)
    expect(result.ratedAmount).toBe('10.0000')
  })
})
