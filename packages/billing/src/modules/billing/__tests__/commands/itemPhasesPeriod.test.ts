import { BillingAccount, BillingItem, BillingItemPhase, BillingItemStatusPeriod } from '../../data/entities'
import { changeItemPriceCommand, createItemCommand, updateItemCommand } from '../../commands/items'
import { billingItemCreateSchema } from '../../data/validators'

/**
 * Item commands with own billing period and price phases (contract C1):
 * create writes item + phases in one flush, update refuses re-pricing
 * invoiced days, change-price carries the remaining phases on their
 * original dates and the running status period.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ACCOUNT = '44444444-4444-4444-8444-444444444444'
const ITEM = '33333333-3333-4333-8333-333333333333'
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

type Row = Record<string, unknown>

function env(options: { item?: Row | null; phases?: Row[]; statuses?: Row[] } = {}) {
  const created: Array<{ entity: unknown; row: Row }> = []
  let flushes = 0
  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === BillingAccount) return { id: ACCOUNT, tenantId: TENANT, organizationId: ORG }
      if (entity === BillingItem) return options.item ?? null
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === BillingItemPhase) return options.phases ?? []
      if (entity === BillingItemStatusPeriod) return options.statuses ?? []
      return []
    }),
    create: jest.fn((entity: unknown, data: Row) => {
      const row = { ...data }
      created.push({ entity, row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {
      flushes += 1
    }),
    transactional: jest.fn(async (fn: (tem: unknown) => Promise<unknown>): Promise<unknown> => fn(em)),
    fork: jest.fn((): unknown => em),
  }
  const ctx = {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'dataEngine') return { markOrmEntityChange: jest.fn(), emitOrmEntityEvent: jest.fn() }
        return em
      }),
    },
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    organizationScope: null,
  }
  return { ctx, em, created, flushes: () => flushes, of: (entity: unknown) => created.filter((c) => c.entity === entity).map((c) => c.row) }
}

const baseCreate = {
  tenantId: TENANT,
  organizationId: ORG,
  billAccountId: ACCOUNT,
  type: 'recurring',
  billStartDate: '2026-12-01',
  description: 'Internet 200 Mb',
  rateJson: { unit_price: 79_900 },
  taxRate: 19,
}

describe('billing.items.create — own period and phases', () => {
  it('stores the period and the phases with the item in one flush', async () => {
    const { ctx, of, flushes } = env()
    const result = await createItemCommand.execute(
      {
        ...baseCreate,
        billingPeriodUnit: 'annually',
        billingPeriodInterval: 1,
        phases: [
          { name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free' },
          { name: 'Promo 50%', durationUnit: 'month', durationCount: 2, priceType: 'percent_off', value: 50 },
        ],
      } as never,
      ctx as never,
    )
    const [item] = of(BillingItem)
    expect(item).toMatchObject({ billingPeriodUnit: 'annually', billingPeriodInterval: 1, phasesEnabled: true })
    expect(result.id).toBe(item.id)
    const phases = of(BillingItemPhase)
    expect(phases).toHaveLength(2)
    expect(phases.map((p) => [p.billingItemId, p.sequence, p.priceType, p.value])).toEqual([
      [item.id, 0, 'free', null],
      [item.id, 1, 'percent_off', '50'],
    ])
    expect(flushes()).toBe(1)
  })

  it('validators reject phases and an own period on non-recurring items, and a period without interval', () => {
    const oneTime = billingItemCreateSchema.safeParse({
      ...baseCreate,
      type: 'one_time',
      rateJson: { amount: 10 },
      billingPeriodUnit: 'weekly',
      billingPeriodInterval: 1,
      phases: [{ durationUnit: 'month', durationCount: 1, priceType: 'free' }],
    })
    expect(oneTime.success).toBe(false)
    const noInterval = billingItemCreateSchema.safeParse({ ...baseCreate, billingPeriodUnit: 'weekly' })
    expect(noInterval.success).toBe(false)
    const tooLong = billingItemCreateSchema.safeParse({ ...baseCreate, billingPeriodUnit: 'annually', billingPeriodInterval: 9 })
    expect(tooLong.success).toBe(false)
  })

  it('validators reject a phase with both a duration and an end date, 13 phases, and percent > 100', () => {
    const both = billingItemCreateSchema.safeParse({
      ...baseCreate,
      phases: [{ durationUnit: 'month', durationCount: 1, endDate: '2027-01-01', priceType: 'free' }],
    })
    expect(both.success).toBe(false)
    const many = billingItemCreateSchema.safeParse({
      ...baseCreate,
      phases: Array.from({ length: 13 }, () => ({ durationUnit: 'day', durationCount: 1, priceType: 'free' })),
    })
    expect(many.success).toBe(false)
    const percent = billingItemCreateSchema.safeParse({
      ...baseCreate,
      phases: [{ durationUnit: 'month', durationCount: 1, priceType: 'percent_off', value: 120 }],
    })
    expect(percent.success).toBe(false)
    const untilBeforeStart = billingItemCreateSchema.safeParse({
      ...baseCreate,
      phases: [{ endDate: '2026-11-15', priceType: 'free' }],
    })
    expect(untilBeforeStart.success).toBe(false)
  })
})

describe('billing.items.update — phases only change unbilled periods', () => {
  const phased = (billedToDate: string | null): Row => ({
    id: ITEM,
    tenantId: TENANT,
    organizationId: ORG,
    type: 'recurring',
    billStartDate: '2026-12-01',
    billEndDate: null,
    billedToDate,
    rateJson: { unit_price: 79_900 },
    phasesEnabled: true,
    priceBasis: 'net',
  })
  const phaseRows = (): Row[] => [
    { id: 'p1', billingItemId: ITEM, sequence: 0, name: 'Free trial', durationUnit: 'month', durationCount: 1, endDate: null, priceType: 'free', value: null },
    { id: 'p2', billingItemId: ITEM, sequence: 1, name: 'Promo 50%', durationUnit: 'month', durationCount: 2, endDate: null, priceType: 'percent_off', value: '50' },
  ]

  it('refuses a change that re-prices an invoiced period, with the credit-memo hint', async () => {
    const { ctx } = env({ item: phased('2026-12-31'), phases: phaseRows() })
    await expect(
      updateItemCommand.execute(
        {
          tenantId: TENANT,
          organizationId: ORG,
          id: ITEM,
          phases: [{ name: 'Promo', durationUnit: 'month', durationCount: 3, priceType: 'percent_off', value: 50 }],
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.phase_edit_billed' } })
  })

  it('allows a change that only touches periods after billed_to_date and replaces the rows', async () => {
    const rows = phaseRows()
    const { ctx, of } = env({ item: phased('2026-12-31'), phases: rows })
    await updateItemCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        id: ITEM,
        phases: [
          { name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'free' },
          { name: 'Promo 25%', durationUnit: 'month', durationCount: 2, priceType: 'percent_off', value: 25 },
        ],
      } as never,
      ctx as never,
    )
    expect(rows.every((r) => r.deletedAt instanceof Date)).toBe(true)
    expect(of(BillingItemPhase).map((p) => p.name)).toEqual(['Free trial', 'Promo 25%'])
  })

  it('switching phases off after the trial was invoiced is refused', async () => {
    const { ctx } = env({ item: phased('2026-12-31'), phases: phaseRows() })
    await expect(
      updateItemCommand.execute({ tenantId: TENANT, organizationId: ORG, id: ITEM, phasesEnabled: false } as never, ctx as never),
    ).rejects.toMatchObject({ body: { code: 'billing.item.phase_edit_billed' } })
  })

  it('sets and clears the own billing period on a recurring item; refuses it on usage', async () => {
    const item = phased(null)
    const { ctx } = env({ item })
    await updateItemCommand.execute(
      { tenantId: TENANT, organizationId: ORG, id: ITEM, billingPeriodUnit: 'weekly', billingPeriodInterval: 2 } as never,
      ctx as never,
    )
    expect(item).toMatchObject({ billingPeriodUnit: 'weekly', billingPeriodInterval: 2 })
    await updateItemCommand.execute({ tenantId: TENANT, organizationId: ORG, id: ITEM, billingPeriodUnit: null } as never, ctx as never)
    expect(item).toMatchObject({ billingPeriodUnit: null, billingPeriodInterval: null })
    const usage = env({ item: { ...phased(null), type: 'usage' } })
    await expect(
      updateItemCommand.execute(
        { tenantId: TENANT, organizationId: ORG, id: ITEM, billingPeriodUnit: 'weekly', billingPeriodInterval: 1 } as never,
        usage.ctx as never,
      ),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('billing.items.update — own billing period is fixed once billed (review G1)', () => {
  const billed = (billedToDate: string | null, period: Row = {}): Row => ({
    id: ITEM,
    tenantId: TENANT,
    organizationId: ORG,
    type: 'recurring',
    billStartDate: '2026-12-01',
    billEndDate: null,
    billedToDate,
    prorate: false,
    rateJson: { unit_price: 3_100 },
    phasesEnabled: false,
    priceBasis: 'net',
    billingPeriodUnit: null,
    billingPeriodInterval: null,
    ...period,
  })

  it('refuses switching to an own period after the item was billed, with the credit-memo hint', async () => {
    const item = billed('2026-12-31')
    const { ctx } = env({ item })
    await expect(
      updateItemCommand.execute(
        { tenantId: TENANT, organizationId: ORG, id: ITEM, billingPeriodUnit: 'monthly', billingPeriodInterval: 3 } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.billing_period_change_billed' } })
    expect(item.billingPeriodUnit).toBeNull()
  })

  it('refuses changing the interval or clearing the period once billed', async () => {
    const own = { billingPeriodUnit: 'monthly', billingPeriodInterval: 1 }
    const a = env({ item: billed('2026-12-31', own) })
    await expect(
      updateItemCommand.execute({ tenantId: TENANT, organizationId: ORG, id: ITEM, billingPeriodInterval: 3 } as never, a.ctx as never),
    ).rejects.toMatchObject({ body: { code: 'billing.item.billing_period_change_billed' } })
    const b = env({ item: billed('2026-12-31', own) })
    await expect(
      updateItemCommand.execute({ tenantId: TENANT, organizationId: ORG, id: ITEM, billingPeriodUnit: null } as never, b.ctx as never),
    ).rejects.toMatchObject({ body: { code: 'billing.item.billing_period_change_billed' } })
  })

  it('re-sending the unchanged period of a billed item is accepted (form saves)', async () => {
    const item = billed('2026-12-31', { billingPeriodUnit: 'monthly', billingPeriodInterval: 1 })
    const { ctx } = env({ item })
    await updateItemCommand.execute(
      { tenantId: TENANT, organizationId: ORG, id: ITEM, billingPeriodUnit: 'monthly', billingPeriodInterval: 1, description: 'Renamed' } as never,
      ctx as never,
    )
    expect(item).toMatchObject({ billingPeriodUnit: 'monthly', billingPeriodInterval: 1 })
  })
})

describe('billing.items.change_price — phases keep their dates', () => {
  it('copies the remaining phases as "until" dates and the running pause', async () => {
    const item: Row = {
      id: ITEM,
      tenantId: TENANT,
      organizationId: ORG,
      billAccountId: ACCOUNT,
      type: 'recurring',
      isActive: true,
      deletedAt: null,
      billStartDate: '2026-12-01',
      billEndDate: null,
      billedToDate: null,
      description: 'Internet',
      rateJson: { unit_price: 79_900 },
      prorate: true,
      phasesEnabled: true,
      billingPeriodUnit: null,
    }
    const { ctx, of } = env({
      item,
      phases: [
        { id: 'p1', billingItemId: ITEM, sequence: 0, name: 'Free trial', durationUnit: 'month', durationCount: 1, endDate: null, priceType: 'free', value: null },
        { id: 'p2', billingItemId: ITEM, sequence: 1, name: 'Promo 50%', durationUnit: 'month', durationCount: 2, endDate: null, priceType: 'percent_off', value: '50' },
      ],
      statuses: [
        { id: 's-old', billingItemId: ITEM, organizationId: ORG, tenantId: TENANT, status: 'paused', fromDate: '2026-12-10', toDate: '2026-12-11', chargeBehavior: 'no_charge' },
        { id: 's-run', billingItemId: ITEM, organizationId: ORG, tenantId: TENANT, status: 'paused', fromDate: '2027-01-10', toDate: null, chargeBehavior: 'no_charge', reason: 'Holiday' },
      ],
    })
    const result = await changeItemPriceCommand.execute(
      { tenantId: TENANT, organizationId: ORG, id: ITEM, effectiveDate: d('2027-01-15'), unitPrice: 89_900 } as never,
      ctx as never,
    )
    const [copy] = of(BillingItem)
    expect(result.newItemId).toBe(copy.id)
    expect(copy).toMatchObject({ phasesEnabled: true, rateJson: { unit_price: 89_900 } })
    // The promo still ends on 28 Feb (it started 1 Jan), it does not restart.
    expect(of(BillingItemPhase).map((p) => [p.name, p.endDate, p.durationUnit, p.priceType])).toEqual([
      ['Promo 50%', '2027-02-28', null, 'percent_off'],
    ])
    expect(of(BillingItemStatusPeriod).map((s) => [s.billingItemId, s.fromDate, s.toDate, s.reason])).toEqual([
      [copy.id, '2027-01-15', null, 'Holiday'],
    ])
  })
})
