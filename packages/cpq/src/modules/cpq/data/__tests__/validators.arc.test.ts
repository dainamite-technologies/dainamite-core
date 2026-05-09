import {
  cpqCreateQuoteFromSubscriptionSchema,
  cpqAttachTargetSubscriptionSchema,
  cpqUpdateTargetSubscriptionSchema,
  cpqCancelMetaSchema,
  cpqMergeMetaSchema,
  cpqExpiringSubscriptionsQuerySchema,
  cpqChangeLogQuerySchema,
  cpqCreateQuoteSchema,
  cpqUpdateQuoteSchema,
  cpqAddQuoteItemSchema,
} from '../validators'

const VALID_UUID = '11111111-1111-4111-8111-111111111111'
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222'

// ─── XD-250 ARC validator coverage ──────────────────────────────

describe('cpqCreateQuoteFromSubscriptionSchema', () => {
  it('accepts a minimal amend payload', () => {
    const result = cpqCreateQuoteFromSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      type: 'amend',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a renew payload with renewTerm', () => {
    const result = cpqCreateQuoteFromSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      type: 'renew',
      renewTerm: {
        newTermStart: '2026-06-01',
        newTermEnd: '2027-06-01',
        newTermMonths: 12,
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid subscriptionId', () => {
    const result = cpqCreateQuoteFromSubscriptionSchema.safeParse({
      subscriptionId: 'not-a-uuid',
      type: 'amend',
    })
    expect(result.success).toBe(false)
  })

  it("rejects type='new' (not an ARC type)", () => {
    const result = cpqCreateQuoteFromSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      type: 'new',
    })
    expect(result.success).toBe(false)
  })
})

describe('cpqAttachTargetSubscriptionSchema', () => {
  it('accepts amend attach without merge fields', () => {
    const result = cpqAttachTargetSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      quoteType: 'amend',
    })
    expect(result.success).toBe(true)
  })

  it('accepts renew attach with mergeAction=standalone', () => {
    const result = cpqAttachTargetSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      quoteType: 'renew',
      mergeAction: 'standalone',
      newTermStart: '2026-06-01',
      newTermEnd: '2027-06-01',
      newTermMonths: 12,
    })
    expect(result.success).toBe(true)
  })

  it('accepts renew attach with mergeAction=absorb', () => {
    const result = cpqAttachTargetSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      quoteType: 'renew',
      mergeAction: 'absorb',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid mergeAction', () => {
    const result = cpqAttachTargetSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      quoteType: 'renew',
      mergeAction: 'survive',
    })
    expect(result.success).toBe(false)
  })

  it("rejects quoteType='new'", () => {
    const result = cpqAttachTargetSubscriptionSchema.safeParse({
      subscriptionId: VALID_UUID,
      quoteType: 'new',
    })
    expect(result.success).toBe(false)
  })
})

describe('cpqUpdateTargetSubscriptionSchema', () => {
  it('accepts a partial patch', () => {
    const result = cpqUpdateTargetSubscriptionSchema.safeParse({
      mergeAction: 'absorb',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty patch (no-op)', () => {
    expect(cpqUpdateTargetSubscriptionSchema.safeParse({}).success).toBe(true)
  })
})

describe('cpqCancelMetaSchema', () => {
  it('accepts a minimal cancel-meta with reason only', () => {
    const result = cpqCancelMetaSchema.safeParse({ reasonCode: 'customer-request' })
    expect(result.success).toBe(true)
  })

  it('accepts ETF amount as string or number', () => {
    expect(
      cpqCancelMetaSchema.safeParse({
        reasonCode: 'non-payment',
        etfAmount: '1500.00',
      }).success,
    ).toBe(true)
    expect(
      cpqCancelMetaSchema.safeParse({
        reasonCode: 'non-payment',
        etfAmount: 1500,
      }).success,
    ).toBe(true)
  })

  it('rejects unknown reasonCode', () => {
    const result = cpqCancelMetaSchema.safeParse({ reasonCode: 'made-up-reason' })
    expect(result.success).toBe(false)
  })

  it('rejects ETF currency longer than 3 chars', () => {
    const result = cpqCancelMetaSchema.safeParse({
      reasonCode: 'non-payment',
      etfCurrency: 'EURO',
    })
    expect(result.success).toBe(false)
  })
})

describe('cpqMergeMetaSchema', () => {
  it('accepts complete merge meta', () => {
    const result = cpqMergeMetaSchema.safeParse({
      newTermStart: '2026-06-01',
      newTermEnd: '2027-06-01',
      newTermMonths: 12,
      newSubCode: 'MERGED-001',
      newSubName: 'Consolidated Contract',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing required term dates', () => {
    expect(cpqMergeMetaSchema.safeParse({}).success).toBe(false)
    expect(
      cpqMergeMetaSchema.safeParse({ newTermStart: '2026-06-01' }).success,
    ).toBe(false)
  })
})

describe('cpqExpiringSubscriptionsQuerySchema', () => {
  it('applies sensible defaults', () => {
    const result = cpqExpiringSubscriptionsQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.withinDays).toBe(30)
    expect(result.data.status).toBe('active')
    expect(result.data.page).toBe(1)
    expect(result.data.pageSize).toBe(50)
  })

  it('coerces string query params to numbers', () => {
    const result = cpqExpiringSubscriptionsQuerySchema.safeParse({
      withinDays: '60',
      page: '2',
      pageSize: '100',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.withinDays).toBe(60)
    expect(result.data.page).toBe(2)
    expect(result.data.pageSize).toBe(100)
  })

  it('rejects withinDays > 365', () => {
    const result = cpqExpiringSubscriptionsQuerySchema.safeParse({ withinDays: '500' })
    expect(result.success).toBe(false)
  })

  it('rejects pageSize > 100', () => {
    const result = cpqExpiringSubscriptionsQuerySchema.safeParse({ pageSize: '500' })
    expect(result.success).toBe(false)
  })
})

describe('cpqChangeLogQuerySchema', () => {
  it('coerces query strings to numbers and applies defaults', () => {
    const result = cpqChangeLogQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.page).toBe(1)
    expect(result.data.pageSize).toBe(50)
  })
})

describe('cpqCreateQuoteSchema (extended for ARC)', () => {
  it("defaults quoteType to 'new'", () => {
    const result = cpqCreateQuoteSchema.safeParse({ customerId: VALID_UUID })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.quoteType).toBe('new')
  })

  it('accepts an explicit ARC quoteType', () => {
    const result = cpqCreateQuoteSchema.safeParse({
      customerId: VALID_UUID,
      quoteType: 'amend',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.quoteType).toBe('amend')
  })
})

describe('cpqUpdateQuoteSchema', () => {
  it('accepts a quoteType update', () => {
    expect(
      cpqUpdateQuoteSchema.safeParse({ quoteType: 'amend' }).success,
    ).toBe(true)
  })

  it('accepts an empty patch', () => {
    expect(cpqUpdateQuoteSchema.safeParse({}).success).toBe(true)
  })
})

describe('cpqAddQuoteItemSchema (ARC fields)', () => {
  it('accepts targetSubscriptionId + sourceSubscriptionItemId', () => {
    const result = cpqAddQuoteItemSchema.safeParse({
      offeringId: VALID_UUID,
      configuration: {},
      targetSubscriptionId: VALID_UUID_2,
      sourceSubscriptionItemId: VALID_UUID,
      action: 'modify',
    })
    expect(result.success).toBe(true)
  })

  it('accepts both ARC fields as null', () => {
    const result = cpqAddQuoteItemSchema.safeParse({
      offeringId: VALID_UUID,
      configuration: {},
      targetSubscriptionId: null,
      sourceSubscriptionItemId: null,
    })
    expect(result.success).toBe(true)
  })
})
