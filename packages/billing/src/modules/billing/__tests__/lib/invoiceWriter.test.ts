import {
  buildInvoiceLinesFromItems,
  buildRecurringLineDescriptors,
  itemTaxRate,
  writeDraftInvoice,
  type InvoiceLineDescriptor,
} from '../../lib/invoiceWriter'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { BillingAccount, BillingItem } from '../../data/entities'

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
    taxRate: overrides.taxRate ?? '0',
    priceBasis: overrides.priceBasis ?? 'net',
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
      unitPrice: '49.9900',
      quantity: '1',
      lineAmount: '49.9900',
      priceBasis: 'net',
      taxRate: '0',
    })
    expect(lines[1].unitPrice).toBe('29.0000')
  })

  it('rounds unit_price half-up to 2dp before persisting', () => {
    const items = [
      makeItem({ type: 'recurring', rateJson: { unit_price: 1.005 } }), // half-up → 1.01
      makeItem({ type: 'recurring', rateJson: { unit_price: 1.004 } }), // half-down → 1.00
    ]
    const lines = buildInvoiceLinesFromItems(items)
    expect(lines[0].unitPrice).toBe('1.0100')
    expect(lines[1].unitPrice).toBe('1.0000')
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
      unitPrice: '99.0000',
      quantity: '1',
      lineAmount: '99.0000',
      priceBasis: 'net',
      taxRate: '0',
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
    expect(lines[0].unitPrice).toBe('-25.5000')
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

// ─── Spec B: VAT per line ────────────────────────────────────────

describe('itemTaxRate', () => {
  it('reads the item rate and treats missing / invalid values as 0', () => {
    expect(itemTaxRate({ taxRate: '23.0000' })).toBe('23')
    expect(itemTaxRate({ taxRate: '8' })).toBe('8')
    expect(itemTaxRate({ taxRate: undefined as unknown as string })).toBe('0')
    expect(itemTaxRate({ taxRate: 'abc' })).toBe('0')
    expect(itemTaxRate({ taxRate: '-5' })).toBe('0')
  })
})

describe('line builders carry the item VAT rate (Spec B)', () => {
  it('one_time and recurring lines take the item rate', () => {
    const lines = buildInvoiceLinesFromItems([
      makeItem({ id: 'r', type: 'recurring', taxRate: '23', rateJson: { unit_price: 100 } }),
      makeItem({ id: 'o', type: 'one_time', taxRate: '8', rateJson: { amount: 50 } }),
    ])
    expect(lines.map((l) => l.taxRate)).toEqual(['23', '8'])
  })

  it('proration and credit lines inherit the item rate', () => {
    const item = { id: 'r', description: 'Plan', chargeTiming: 'in_advance' as const, taxRate: '23', priceBasis: 'net' as const }
    const lines = buildRecurringLineDescriptors(item, [
      {
        kind: 'charge',
        servicePeriodStart: new Date('2026-11-15T00:00:00Z'),
        servicePeriodEnd: new Date('2026-11-30T00:00:00Z'),
        amount: 53.33,
        proration: { activeDays: 16, periodDays: 30 },
      },
      {
        kind: 'credit',
        servicePeriodStart: new Date('2026-12-10T00:00:00Z'),
        servicePeriodEnd: new Date('2026-12-31T00:00:00Z'),
        amount: -71,
        proration: { activeDays: 22, periodDays: 31 },
      },
    ] as never)
    expect(lines.map((l) => l.taxRate)).toEqual(['23', '23'])
  })

  it('freezes the item credit reason into credit lines only (Part 2)', () => {
    const item = {
      id: 'r',
      description: 'Plan',
      chargeTiming: 'in_advance' as const,
      taxRate: '23',
      priceBasis: 'net' as const,
      creditReason: { kind: 'text', text: 'Downgrade' },
    }
    const lines = buildRecurringLineDescriptors(item, [
      {
        kind: 'charge',
        servicePeriodStart: new Date('2026-12-01T00:00:00Z'),
        servicePeriodEnd: new Date('2026-12-31T00:00:00Z'),
        amount: 100,
        proration: null,
      },
      {
        kind: 'credit',
        servicePeriodStart: new Date('2026-12-10T00:00:00Z'),
        servicePeriodEnd: new Date('2026-12-31T00:00:00Z'),
        amount: -71,
        proration: { activeDays: 22, periodDays: 31 },
      },
    ] as never)
    expect(lines[0].metadataExtra).not.toHaveProperty('credit_reason')
    expect(lines[1].metadataExtra).toMatchObject({ credit_reason: { kind: 'text', text: 'Downgrade' } })
  })
})

type Created = { entity: string; data: Record<string, unknown> }

function writerEm() {
  const created: Created[] = []
  const em = {
    create: jest.fn((entity: { name: string }, data: Record<string, unknown>) => {
      const row = { id: `${entity.name}-${created.length + 1}`, ...data }
      created.push({ entity: entity.name, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { em: em as unknown as EntityManager, created }
}

const account = {
  id: 'acc-1',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  currencyCode: 'PLN',
} as BillingAccount

function line(amount: string, taxRate: string, priceBasis: 'net' | 'gross' = 'net'): InvoiceLineDescriptor {
  return {
    billingItemId: 'item',
    billingType: 'recurring',
    description: 'x',
    unitPrice: amount,
    quantity: '1',
    lineAmount: amount,
    priceBasis,
    taxRate,
  }
}

const baseParams = {
  account,
  billDate: new Date('2026-11-01T00:00:00Z'),
  period: { periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-11-30T00:00:00Z') },
  billRunId: 'run-1',
}

describe('writeDraftInvoice — VAT (Spec B, B-D2)', () => {
  it('writes per-line VAT and sums rounded lines into the totals (mixed rates)', async () => {
    const { em, created } = writerEm()
    const written = await writeDraftInvoice(em, {
      ...baseParams,
      mode: 'real',
      lines: [line('100.0000', '23'), line('33.3300', '8'), line('15.0000', '0')],
    })
    const invoice = created.find((c) => c.entity === 'BillingInvoice')!.data
    const lines = created.filter((c) => c.entity === 'BillingInvoiceLine').map((c) => c.data)
    expect(lines.map((l) => [l.taxRate, l.netAmount, l.taxAmount, l.grossAmount])).toEqual([
      ['23', '100.0000', '23.0000', '123.0000'],
      ['8', '33.3300', '2.6700', '36.0000'],
      ['0', '15.0000', '0.0000', '15.0000'],
    ])
    expect(invoice).toMatchObject({
      subtotalNet: '148.3300',
      taxTotal: '25.6700',
      totalGross: '174.0000',
      outstanding: '174.0000',
    })
    expect(written).toMatchObject({ totalNet: '148.3300', totalGross: '174.0000' })
  })

  it('rounds VAT per line half-up (0.005 edge)', async () => {
    const { em, created } = writerEm()
    // 0.05 × 23 % = 0.0115 → 0.01 ; 2.15 × 23 % = 0.4945 → 0.49 ; 0.5 × 5 % = 0.025 → 0.03
    await writeDraftInvoice(em, {
      ...baseParams,
      mode: 'real',
      lines: [line('0.0500', '23'), line('2.1500', '23'), line('0.5000', '5')],
    })
    const taxes = created.filter((c) => c.entity === 'BillingInvoiceLine').map((c) => c.data.taxAmount)
    expect(taxes).toEqual(['0.0100', '0.4900', '0.0300'])
  })

  it('keeps the sign on credit lines (negative net → negative VAT and gross)', async () => {
    const { em, created } = writerEm()
    await writeDraftInvoice(em, {
      ...baseParams,
      mode: 'real',
      lines: [line('100.0000', '23'), line('-40.0000', '23')],
    })
    const credit = created.filter((c) => c.entity === 'BillingInvoiceLine')[1].data
    expect([credit.netAmount, credit.taxAmount, credit.grossAmount]).toEqual(['-40.0000', '-9.2000', '-49.2000'])
    expect(created.find((c) => c.entity === 'BillingInvoice')!.data.totalGross).toBe('73.8000')
  })

  it('dry mode computes VAT totals without persisting', async () => {
    const { em, created } = writerEm()
    const written = await writeDraftInvoice(em, { ...baseParams, mode: 'dry', lines: [line('10.0000', '23')] })
    expect(created).toHaveLength(0)
    expect(written).toEqual({ invoiceId: null, invoiceNumber: null, totalNet: '10.0000', totalGross: '12.3000' })
  })
})

// ─── Spec F: price basis (F-D2) ──────────────────────────────────

describe('writeDraftInvoice — gross price basis (Spec F)', () => {
  it('reproduces a typed gross exactly (49.99 @ 23 %) and derives the net unit price', async () => {
    const { em, created } = writerEm()
    await writeDraftInvoice(em, { ...baseParams, mode: 'real', lines: [line('49.9900', '23', 'gross')] })
    const persisted = created.find((c) => c.entity === 'BillingInvoiceLine')!.data
    expect([persisted.netAmount, persisted.taxAmount, persisted.grossAmount]).toEqual(['40.6400', '9.3500', '49.9900'])
    expect(persisted.unitPriceNet).toBe('40.6423')
    expect(created.find((c) => c.entity === 'BillingInvoice')!.data.totalGross).toBe('49.9900')
  })

  it('keeps the net path unchanged (regression)', async () => {
    const { em, created } = writerEm()
    await writeDraftInvoice(em, { ...baseParams, mode: 'real', lines: [line('40.6400', '23')] })
    const persisted = created.find((c) => c.entity === 'BillingInvoiceLine')!.data
    expect([persisted.netAmount, persisted.taxAmount, persisted.grossAmount, persisted.unitPriceNet]).toEqual([
      '40.6400',
      '9.3500',
      '49.9900',
      '40.6400',
    ])
  })

  it('carries the item basis on one-time, recurring and prorated lines', () => {
    const built = buildInvoiceLinesFromItems([
      makeItem({ id: 'g', type: 'recurring', priceBasis: 'gross', rateJson: { unit_price: 60 } }),
      makeItem({ id: 'n', type: 'one_time', rateJson: { amount: 10 } }),
    ])
    expect(built.map((l) => l.priceBasis)).toEqual(['gross', 'net'])
    const prorated = buildRecurringLineDescriptors(
      { id: 'g', description: 'Plan', chargeTiming: 'in_advance', taxRate: '23', priceBasis: 'gross' },
      [
        {
          billingItemId: 'g',
          kind: 'charge',
          servicePeriodStart: new Date('2026-11-15T00:00:00Z'),
          servicePeriodEnd: new Date('2026-11-30T00:00:00Z'),
          amount: 32,
          proration: { activeDays: 16, periodDays: 30 },
        },
      ],
    )
    expect(prorated[0]).toMatchObject({ priceBasis: 'gross', lineAmount: '32.0000' })
  })
})
