/**
 * Validator tests for rate_json shapes — the contract used by the Bill Run
 * engine to trust pricing definitions. Every legal shape must parse;
 * every shape rejected by the spec must throw at parse time.
 */

import {
  BILL_CYCLES,
  BILLING_ITEM_TYPES,
  BILL_RUN_STATUSES,
  INVOICE_STATUSES,
  billCycleAnchorSchema,
  invoiceAddressSchema,
  rateJsonOneTime,
  rateJsonRecurring,
  rateJsonUsageFlat,
  rateJsonUsageGraduated,
  rateJsonUsageSimple,
  rateJsonUsageTiered,
  rateJsonUsageVolume,
  validateRateJson,
} from '../data/validators'

describe('rate_json — one_time', () => {
  it('accepts a positive amount', () => {
    expect(rateJsonOneTime.parse({ amount: 99 })).toEqual({ amount: 99 })
  })

  it('accepts zero', () => {
    expect(rateJsonOneTime.parse({ amount: 0 })).toEqual({ amount: 0 })
  })

  it('accepts negative amount (refund / credit / negative proration)', () => {
    expect(rateJsonOneTime.parse({ amount: -25.5 })).toEqual({ amount: -25.5 })
  })

  it('rejects missing amount', () => {
    expect(() => rateJsonOneTime.parse({})).toThrow()
  })

  it('rejects non-numeric amount', () => {
    expect(() => rateJsonOneTime.parse({ amount: '99' })).toThrow()
  })

  it('rejects extra keys (strict)', () => {
    expect(() => rateJsonOneTime.parse({ amount: 99, unit_price: 49 })).toThrow()
  })
})

describe('rate_json — recurring', () => {
  it('accepts positive unit_price', () => {
    expect(rateJsonRecurring.parse({ unit_price: 49.99 })).toEqual({ unit_price: 49.99 })
  })

  it('accepts zero', () => {
    expect(rateJsonRecurring.parse({ unit_price: 0 })).toEqual({ unit_price: 0 })
  })

  it('rejects negative unit_price (discounts must be one_time credit items)', () => {
    expect(() => rateJsonRecurring.parse({ unit_price: -1 })).toThrow()
  })

  it('rejects missing unit_price', () => {
    expect(() => rateJsonRecurring.parse({})).toThrow()
  })
})

describe('rate_json — usage simple', () => {
  it('accepts positive unit_price', () => {
    expect(rateJsonUsageSimple.parse({ unit_price: 0.001 })).toEqual({ unit_price: 0.001 })
  })

  it('rejects negative unit_price', () => {
    expect(() => rateJsonUsageSimple.parse({ unit_price: -0.001 })).toThrow()
  })
})

describe('rate_json — usage tiered (volume)', () => {
  it('accepts a well-formed volume tier ladder', () => {
    const value = {
      model: 'volume' as const,
      tiers: [
        { up_to: 10000, unit_price: 0 },
        { up_to: 50000, unit_price: 0.001 },
        { up_to: null, unit_price: 0.0005 },
      ],
    }
    expect(rateJsonUsageVolume.parse(value)).toEqual(value)
  })

  it('rejects ladder without an open-ended top tier', () => {
    expect(() =>
      rateJsonUsageVolume.parse({
        model: 'volume',
        tiers: [
          { up_to: 10000, unit_price: 0 },
          { up_to: 50000, unit_price: 0.001 },
        ],
      }),
    ).toThrow()
  })

  it('rejects ladder with multiple open-ended top tiers', () => {
    expect(() =>
      rateJsonUsageVolume.parse({
        model: 'volume',
        tiers: [
          { up_to: null, unit_price: 0 },
          { up_to: null, unit_price: 0.001 },
        ],
      }),
    ).toThrow()
  })

  it('rejects ladder where up_to values are not strictly increasing', () => {
    expect(() =>
      rateJsonUsageVolume.parse({
        model: 'volume',
        tiers: [
          { up_to: 50000, unit_price: 0 },
          { up_to: 10000, unit_price: 0.001 },
          { up_to: null, unit_price: 0.0005 },
        ],
      }),
    ).toThrow()
  })

  it('rejects ladder where open-ended tier is not last', () => {
    expect(() =>
      rateJsonUsageVolume.parse({
        model: 'volume',
        tiers: [
          { up_to: null, unit_price: 0.0005 },
          { up_to: 10000, unit_price: 0 },
        ],
      }),
    ).toThrow()
  })

  it('rejects negative unit_price in a tier', () => {
    expect(() =>
      rateJsonUsageVolume.parse({
        model: 'volume',
        tiers: [{ up_to: null, unit_price: -0.001 }],
      }),
    ).toThrow()
  })
})

describe('rate_json — usage tiered (graduated)', () => {
  it('accepts a well-formed graduated tier ladder', () => {
    const value = {
      model: 'graduated' as const,
      tiers: [
        { up_to: 10000, unit_price: 0 },
        { up_to: null, unit_price: 0.001 },
      ],
    }
    expect(rateJsonUsageGraduated.parse(value)).toEqual(value)
  })

  it('rejects mixing flat_amount into a graduated ladder', () => {
    // Even if the value parses as `volume`/`graduated` shape with a `flat_amount`
    // key, strict mode rejects it because the tier schema is strict on keys.
    expect(() =>
      rateJsonUsageGraduated.parse({
        model: 'graduated',
        tiers: [{ up_to: null, flat_amount: 100 }],
      }),
    ).toThrow()
  })
})

describe('rate_json — usage tiered (flat)', () => {
  it('accepts a well-formed flat-tier ladder', () => {
    const value = {
      model: 'flat' as const,
      tiers: [
        { up_to: 10000, flat_amount: 50 },
        { up_to: null, flat_amount: 200 },
      ],
    }
    expect(rateJsonUsageFlat.parse(value)).toEqual(value)
  })

  it('rejects flat ladder using unit_price instead of flat_amount', () => {
    expect(() =>
      rateJsonUsageFlat.parse({
        model: 'flat',
        tiers: [{ up_to: null, unit_price: 100 }],
      }),
    ).toThrow()
  })
})

describe('rate_json — discriminated tiered union', () => {
  it.each([
    ['volume', { up_to: null, unit_price: 0 }],
    ['graduated', { up_to: null, unit_price: 0 }],
    ['flat', { up_to: null, flat_amount: 0 }],
  ] as const)('parses a minimal %s ladder', (model, tier) => {
    expect(rateJsonUsageTiered.parse({ model, tiers: [tier] })).toBeDefined()
  })

  it('rejects unknown tier model', () => {
    expect(() =>
      rateJsonUsageTiered.parse({
        model: 'logarithmic' as unknown as 'volume',
        tiers: [{ up_to: null, unit_price: 0 }],
      }),
    ).toThrow()
  })
})

describe('validateRateJson dispatcher', () => {
  it('routes one_time → one_time schema', () => {
    expect(validateRateJson('one_time', { amount: 99 })).toEqual({ amount: 99 })
  })

  it('routes recurring → recurring schema', () => {
    expect(validateRateJson('recurring', { unit_price: 49 })).toEqual({ unit_price: 49 })
  })

  it('routes usage (simple) → usage schema', () => {
    expect(validateRateJson('usage', { unit_price: 0.001 })).toEqual({ unit_price: 0.001 })
  })

  it('routes usage (tiered) → usage schema', () => {
    expect(
      validateRateJson('usage', {
        model: 'graduated',
        tiers: [{ up_to: null, unit_price: 0.001 }],
      }),
    ).toBeDefined()
  })

  it('rejects one_time payload submitted as recurring (cross-shape mistake)', () => {
    expect(() => validateRateJson('recurring', { amount: 99 })).toThrow()
  })

  it('rejects negative unit_price on recurring even when dispatched generically', () => {
    expect(() => validateRateJson('recurring', { unit_price: -1 })).toThrow()
  })
})

describe('billCycleAnchorSchema', () => {
  it.each(['1', '15', '28'])('accepts day-of-month %s', (day) => {
    expect(billCycleAnchorSchema.parse(day)).toBe(day)
  })

  it.each(['0', '29', '32', 'foo'])('rejects invalid anchor %s', (val) => {
    expect(() => billCycleAnchorSchema.parse(val)).toThrow()
  })

  it.each(['mon', 'tue', 'sun', 'MON'])('accepts weekday anchor %s', (day) => {
    expect(billCycleAnchorSchema.parse(day)).toBe(day)
  })
})

describe('invoiceAddressSchema', () => {
  it('accepts a minimum-viable address', () => {
    const value = {
      line1: 'ul. Marszałkowska 1',
      city: 'Warsaw',
      postal_code: '00-001',
      country: 'PL',
    }
    expect(invoiceAddressSchema.parse(value)).toEqual(value)
  })

  it('rejects missing required fields', () => {
    expect(() =>
      invoiceAddressSchema.parse({ line1: '', city: 'Warsaw', postal_code: '00-001', country: 'PL' }),
    ).toThrow()
  })
})

describe('exported enums', () => {
  it('BILLING_ITEM_TYPES matches spec', () => {
    expect([...BILLING_ITEM_TYPES]).toEqual(['one_time', 'recurring', 'usage'])
  })

  it('BILL_CYCLES matches spec', () => {
    expect([...BILL_CYCLES]).toEqual(['weekly', 'monthly', 'quarterly', 'annually'])
  })

  it('BILL_RUN_STATUSES matches spec', () => {
    expect([...BILL_RUN_STATUSES]).toEqual([
      'running',
      'completed',
      'partial_failure',
      'failed',
    ])
  })

  it('INVOICE_STATUSES matches the dictionary entries seeded by setup', () => {
    expect([...INVOICE_STATUSES]).toEqual(['draft', 'posted', 'paid', 'void'])
  })
})

// ─── Phase 1 — CRUD payload schemas ────────────────────────────────

import {
  billingAccountCreateSchema,
  billingAccountListQuerySchema,
  billingAccountUpdateSchema,
  billingItemCreateSchema,
  billingItemListQuerySchema,
  billingItemUpdateSchema,
  billingUsageCreateSchema,
  billingUsageListQuerySchema,
} from '../data/validators'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ACCOUNT = '33333333-3333-4333-8333-333333333333'

const validAddress = {
  line1: 'ul. Marszałkowska 1',
  city: 'Warsaw',
  postal_code: '00-001',
  country: 'PL',
}

const validAccountCreate = {
  tenantId: TENANT,
  organizationId: ORG,
  customerId: 'cust-1',
  name: 'Acme Sp. z o.o.',
  currencyCode: 'eur', // lowercase; schema upcases
  billCycle: 'monthly',
  billCycleAnchor: '1',
  invoiceEmail: 'AR@acme.test',
  invoiceLanguage: 'PL', // schema downcases
  invoiceAddress: validAddress,
  nextBillDate: '2026-06-01',
}

describe('billingAccountCreateSchema', () => {
  it('accepts a minimum-viable payload and normalizes case', () => {
    const parsed = billingAccountCreateSchema.parse(validAccountCreate)
    expect(parsed.currencyCode).toBe('EUR')
    expect(parsed.invoiceLanguage).toBe('pl')
    expect(parsed.nextBillDate).toBeInstanceOf(Date)
  })

  it('rejects an invalid currency length', () => {
    expect(() =>
      billingAccountCreateSchema.parse({ ...validAccountCreate, currencyCode: 'EURO' }),
    ).toThrow()
  })

  it('rejects an invalid bill cycle anchor (day 32)', () => {
    expect(() =>
      billingAccountCreateSchema.parse({ ...validAccountCreate, billCycleAnchor: '32' }),
    ).toThrow()
  })

  it('rejects unknown bill cycle', () => {
    expect(() =>
      billingAccountCreateSchema.parse({ ...validAccountCreate, billCycle: 'fortnightly' }),
    ).toThrow()
  })

  it('rejects missing tenantId / organizationId (scope is mandatory)', () => {
    const { tenantId, ...withoutTenant } = validAccountCreate
    expect(() => billingAccountCreateSchema.parse(withoutTenant)).toThrow()
    void tenantId
  })
})

describe('billingAccountUpdateSchema', () => {
  it('accepts a partial update with just id + scope', () => {
    const parsed = billingAccountUpdateSchema.parse({
      tenantId: TENANT,
      organizationId: ORG,
      id: ACCOUNT,
      name: 'Acme Renamed',
    })
    expect(parsed.name).toBe('Acme Renamed')
  })

  it('rejects payload missing id', () => {
    expect(() =>
      billingAccountUpdateSchema.parse({
        tenantId: TENANT,
        organizationId: ORG,
        name: 'x',
      }),
    ).toThrow()
  })

  it('does not declare currencyCode (immutable per spec)', () => {
    expect('currencyCode' in billingAccountUpdateSchema.shape).toBe(false)
  })

  it('does not declare customerId (immutable per spec)', () => {
    expect('customerId' in billingAccountUpdateSchema.shape).toBe(false)
  })
})

describe('billingAccountListQuerySchema', () => {
  it('coerces page/pageSize from query strings', () => {
    const parsed = billingAccountListQuerySchema.parse({ page: '2', pageSize: '25' })
    expect(parsed.page).toBe(2)
    expect(parsed.pageSize).toBe(25)
  })

  it('caps pageSize at 100', () => {
    expect(() => billingAccountListQuerySchema.parse({ pageSize: '500' })).toThrow()
  })

  it('uses page=1, pageSize=50 as defaults', () => {
    const parsed = billingAccountListQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(50)
  })
})

const validItemRecurring = {
  tenantId: TENANT,
  organizationId: ORG,
  billAccountId: ACCOUNT,
  type: 'recurring' as const,
  billStartDate: '2026-05-01',
  description: 'MRC — Plan A',
  rateJson: { unit_price: 49.99 },
}

describe('billingItemCreateSchema', () => {
  it('accepts a well-formed recurring item', () => {
    const parsed = billingItemCreateSchema.parse(validItemRecurring)
    expect(parsed.type).toBe('recurring')
    expect(parsed.rateJson).toEqual({ unit_price: 49.99 })
  })

  it('rejects recurring item with one_time-shaped rateJson', () => {
    expect(() =>
      billingItemCreateSchema.parse({ ...validItemRecurring, rateJson: { amount: 99 } }),
    ).toThrow()
  })

  it('requires uomCode for type=usage', () => {
    expect(() =>
      billingItemCreateSchema.parse({
        ...validItemRecurring,
        type: 'usage',
        rateJson: { unit_price: 0.001 },
        uomCode: undefined,
      }),
    ).toThrow()
  })

  it('accepts type=usage with uomCode + simple rate', () => {
    const parsed = billingItemCreateSchema.parse({
      ...validItemRecurring,
      type: 'usage',
      rateJson: { unit_price: 0.001 },
      uomCode: 'api_request',
    })
    expect(parsed.uomCode).toBe('api_request')
  })

  it('accepts a tiered graduated rate', () => {
    const parsed = billingItemCreateSchema.parse({
      ...validItemRecurring,
      type: 'usage',
      uomCode: 'api_request',
      rateJson: {
        model: 'graduated',
        tiers: [
          { up_to: 10000, unit_price: 0 },
          { up_to: null, unit_price: 0.001 },
        ],
      },
    })
    expect((parsed.rateJson as { model: string }).model).toBe('graduated')
  })

  it('rejects a malformed tiered rate (no open top tier)', () => {
    expect(() =>
      billingItemCreateSchema.parse({
        ...validItemRecurring,
        type: 'usage',
        uomCode: 'api_request',
        rateJson: {
          model: 'graduated',
          tiers: [{ up_to: 10000, unit_price: 0 }],
        },
      }),
    ).toThrow()
  })

  it('accepts an optional sourceRef (idempotency key)', () => {
    const parsed = billingItemCreateSchema.parse({
      ...validItemRecurring,
      sourceRef: 'cpq-sub-X-mrc',
    })
    expect(parsed.sourceRef).toBe('cpq-sub-X-mrc')
  })
})

describe('billingItemUpdateSchema', () => {
  it('does NOT allow changing type (immutable per spec)', () => {
    expect('type' in billingItemUpdateSchema.shape).toBe(false)
  })

  it('does NOT allow changing sourceRef (immutable per spec)', () => {
    expect('sourceRef' in billingItemUpdateSchema.shape).toBe(false)
  })

  it('allows updating description + rateJson', () => {
    const parsed = billingItemUpdateSchema.parse({
      tenantId: TENANT,
      organizationId: ORG,
      id: ACCOUNT,
      description: 'Updated description',
      rateJson: { unit_price: 59.99 },
    })
    expect(parsed.description).toBe('Updated description')
  })
})

describe('billingItemListQuerySchema', () => {
  it('filters by type with enum validation', () => {
    expect(billingItemListQuerySchema.parse({ type: 'recurring' }).type).toBe('recurring')
    expect(() => billingItemListQuerySchema.parse({ type: 'invalid' })).toThrow()
  })

  it('coerces activeAt to a Date', () => {
    const parsed = billingItemListQuerySchema.parse({ activeAt: '2026-05-15' })
    expect(parsed.activeAt).toBeInstanceOf(Date)
  })
})

const validUsageCreate = {
  tenantId: TENANT,
  organizationId: ORG,
  billAccountId: ACCOUNT,
  uomCode: 'api_request',
  quantity: 12345,
  periodStart: '2026-05-01T00:00:00Z',
  periodEnd: '2026-05-31T23:59:59Z',
}

describe('billingUsageCreateSchema', () => {
  it('accepts a valid usage record', () => {
    const parsed = billingUsageCreateSchema.parse(validUsageCreate)
    expect(parsed.quantity).toBe(12345)
    expect(parsed.uomCode).toBe('api_request')
  })

  it('rejects negative quantity (refund modeled as one_time credit)', () => {
    expect(() =>
      billingUsageCreateSchema.parse({ ...validUsageCreate, quantity: -5 }),
    ).toThrow()
  })

  it('rejects periodEnd before periodStart', () => {
    expect(() =>
      billingUsageCreateSchema.parse({
        ...validUsageCreate,
        periodStart: '2026-05-31T00:00:00Z',
        periodEnd: '2026-05-01T00:00:00Z',
      }),
    ).toThrow()
  })

  it('accepts a per-record line_description (breakdown reporting hint)', () => {
    const parsed = billingUsageCreateSchema.parse({
      ...validUsageCreate,
      lineDescription: 'API key X — 753k input tokens, 2026-02-23..25',
    })
    expect(parsed.lineDescription).toContain('753k')
  })

  it('accepts an optional sourceRef (idempotency key)', () => {
    const parsed = billingUsageCreateSchema.parse({
      ...validUsageCreate,
      sourceRef: 'metrics-2026-05-31',
    })
    expect(parsed.sourceRef).toBe('metrics-2026-05-31')
  })
})

describe('billingUsageListQuerySchema', () => {
  it('coerces rated=true to boolean', () => {
    expect(billingUsageListQuerySchema.parse({ rated: 'true' }).rated).toBe(true)
  })

  it('caps pageSize at 100', () => {
    expect(() => billingUsageListQuerySchema.parse({ pageSize: '101' })).toThrow()
  })
})
