import { buildInvoiceLinesFromItems } from '../../lib/invoiceWriter'
import type { BillingItem } from '../../data/entities'

function makeItem(overrides: Partial<BillingItem>): BillingItem {
  return {
    id: overrides.id ?? 'item-1',
    organizationId: overrides.organizationId ?? 'org-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    billAccountId: overrides.billAccountId ?? 'account-1',
    type: overrides.type ?? 'recurring',
    billStartDate: overrides.billStartDate ?? new Date('2026-01-01'),
    billEndDate: overrides.billEndDate ?? null,
    description: overrides.description ?? 'desc',
    rateJson: overrides.rateJson ?? { unit_price: 49.99 },
    uomCode: overrides.uomCode ?? null,
    subscriptionId: overrides.subscriptionId ?? null,
    subscriptionItemId: overrides.subscriptionItemId ?? null,
    sourceRef: overrides.sourceRef ?? null,
    currencyMismatch: overrides.currencyMismatch ?? false,
    billedToDate: overrides.billedToDate ?? null,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    deletedAt: overrides.deletedAt ?? null,
  } as BillingItem
}

describe('buildInvoiceLinesFromItems — recurring', () => {
  it('builds one line per recurring item with unit_price = rateJson.unit_price', () => {
    const items = [
      makeItem({ id: 'a', type: 'recurring', description: 'MRC A', rateJson: { unit_price: 49.99 } }),
      makeItem({ id: 'b', type: 'recurring', description: 'MRC B', rateJson: { unit_price: 29 } }),
    ]
    const lines = buildInvoiceLinesFromItems(items)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      billingItemId: 'a',
      billingType: 'recurring',
      description: 'MRC A',
      unitPriceNet: '49.9900',
      quantity: '1',
      totalNetAmount: '49.9900',
    })
    expect(lines[1].unitPriceNet).toBe('29.0000')
  })

  it('rounds unit_price half-up to 2dp before persisting', () => {
    const items = [
      makeItem({ type: 'recurring', rateJson: { unit_price: 1.005 } }), // half-up → 1.01
      makeItem({ type: 'recurring', rateJson: { unit_price: 1.004 } }), // half-down → 1.00
    ]
    const lines = buildInvoiceLinesFromItems(items)
    expect(lines[0].unitPriceNet).toBe('1.0100')
    expect(lines[1].unitPriceNet).toBe('1.0000')
  })

  it('skips a recurring item with malformed rateJson (defensive)', () => {
    const wrong = makeItem({ type: 'recurring', rateJson: { amount: 49 } as never })
    // Override directly because `makeItem`'s `??` would replace a null
    // with the default — we need the actual null on the persisted item
    // to exercise the builder's guard.
    const nullRate = makeItem({ type: 'recurring' })
    ;(nullRate as { rateJson: unknown }).rateJson = null
    expect(buildInvoiceLinesFromItems([wrong, nullRate])).toEqual([])
  })
})

describe('buildInvoiceLinesFromItems — one_time', () => {
  it('builds one line with amount = rateJson.amount, quantity 1', () => {
    const items = [
      makeItem({
        id: 'fee',
        type: 'one_time',
        description: 'Activation fee',
        rateJson: { amount: 99 },
      }),
    ]
    const lines = buildInvoiceLinesFromItems(items)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({
      billingItemId: 'fee',
      billingType: 'one_time',
      description: 'Activation fee',
      unitPriceNet: '99.0000',
      quantity: '1',
      totalNetAmount: '99.0000',
    })
  })

  it('preserves negative amounts (credit / refund / negative proration)', () => {
    const items = [
      makeItem({
        type: 'one_time',
        description: 'Cancellation credit',
        rateJson: { amount: -25.5 },
      }),
    ]
    const lines = buildInvoiceLinesFromItems(items)
    expect(lines[0].unitPriceNet).toBe('-25.5000')
  })
})

describe('buildInvoiceLinesFromItems — mixed + usage exclusion', () => {
  it('mixes one_time and recurring while excluding usage', () => {
    const items = [
      makeItem({ id: 'mrc', type: 'recurring', description: 'MRC', rateJson: { unit_price: 49 } }),
      makeItem({ id: 'fee', type: 'one_time', description: 'Setup', rateJson: { amount: 99 } }),
      makeItem({
        id: 'metered',
        type: 'usage',
        description: 'API',
        rateJson: { unit_price: 0.001 },
      }),
    ]
    const lines = buildInvoiceLinesFromItems(items)
    expect(lines.map((l) => l.billingType)).toEqual(['recurring', 'one_time'])
    expect(lines.find((l) => l.billingItemId === 'metered')).toBeUndefined()
  })
})
