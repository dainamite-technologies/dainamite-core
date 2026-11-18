jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return { ...actual, emitCrudSideEffects: jest.fn(async () => undefined) }
})

import { planPriceChange } from '../../lib/itemPriceChange'
import { computeRecurringLines } from '../../lib/servicePeriods'
import { changeItemPriceCommand } from '../../commands/items'

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)
const d = (value: string) => new Date(`${value}T00:00:00.000Z`)

const recurring = {
  type: 'recurring',
  isActive: true,
  deletedAt: null,
  billStartDate: '2026-11-01',
  billEndDate: null as string | null,
}

describe('planPriceChange', () => {
  it('ends the current item the day before and keeps the original end date on the copy', () => {
    const result = planPriceChange({ ...recurring, billEndDate: '2027-06-30' }, '2026-12-15')
    if (!result.ok) throw new Error(result.error)
    expect(iso(result.plan.oldItemEndDate)).toBe('2026-12-14')
    expect(iso(result.plan.newItemStartDate)).toBe('2026-12-15')
    expect(iso(result.plan.newItemEndDate)).toBe('2027-06-30')
  })

  it('refuses non-recurring, inactive, on/before start and after end', () => {
    expect(planPriceChange({ ...recurring, type: 'one_time' }, '2026-12-15')).toEqual({
      ok: false,
      error: 'billing.item.price_change_recurring_only',
    })
    expect(planPriceChange({ ...recurring, isActive: false }, '2026-12-15')).toMatchObject({ error: 'billing.item.price_change_inactive' })
    expect(planPriceChange(recurring, '2026-11-01')).toMatchObject({ error: 'billing.item.price_change_before_start' })
    expect(planPriceChange({ ...recurring, billEndDate: '2026-12-31' }, '2027-01-01')).toMatchObject({
      error: 'billing.item.price_change_after_end',
    })
  })
})

describe('price change never bills a day twice (engine maths)', () => {
  // Monthly in advance, billed through Dec 13 at 30; price changes to 60 on Nov 24.
  const base = {
    chargeTiming: 'in_advance' as const,
    billStartDate: d('2026-11-14'),
    billedToDate: d('2026-12-13'),
    isActive: true,
    deletedAt: null,
  }

  it('prorate on: the old item credits Nov 24 – Dec 13, the new item charges the same days at the new price', () => {
    const old = computeRecurringLines(
      { ...base, id: 'old', prorate: true, billEndDate: d('2026-11-23'), unitPrice: 30 },
      { billDate: d('2026-12-14'), cycle: 'monthly' },
    )
    const fresh = computeRecurringLines(
      { ...base, id: 'new', prorate: true, billStartDate: d('2026-11-24'), billEndDate: null, billedToDate: null, unitPrice: 60 },
      { billDate: d('2026-12-14'), cycle: 'monthly' },
    )
    const credit = old.lines.find((line) => line.kind === 'credit')!
    expect([iso(credit.servicePeriodStart), iso(credit.servicePeriodEnd)]).toEqual(['2026-11-24', '2026-12-13'])
    expect(credit.amount).toBeLessThan(0)
    const recharge = fresh.lines.find((line) => iso(line.servicePeriodStart) === '2026-11-24')!
    expect(iso(recharge.servicePeriodEnd)).toBe('2026-12-13')
    expect(recharge.amount).toBeCloseTo(-credit.amount * 2, 1) // same days, double the price
  })

  it('prorate off: no credit, and the new item starts charging at its next full period', () => {
    const old = computeRecurringLines(
      { ...base, id: 'old', prorate: false, billEndDate: d('2026-11-23'), unitPrice: 30 },
      { billDate: d('2026-12-14'), cycle: 'monthly' },
    )
    const fresh = computeRecurringLines(
      { ...base, id: 'new', prorate: false, billStartDate: d('2026-11-24'), billEndDate: null, billedToDate: null, unitPrice: 60 },
      { billDate: d('2026-12-14'), cycle: 'monthly' },
    )
    expect(old.lines).toHaveLength(0)
    expect(fresh.lines.map((line) => [iso(line.servicePeriodStart), iso(line.servicePeriodEnd)])).toEqual([
      ['2026-12-14', '2027-01-13'],
    ])
  })
})

describe('changeItemPriceCommand', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111'
  const ORG = '22222222-2222-4222-8222-222222222222'
  const ITEM = '33333333-3333-4333-8333-333333333333'

  function env(record: Record<string, unknown> | null) {
    const created: Record<string, unknown>[] = []
    const em = {
      findOne: jest.fn(async () => record),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
        const row = { id: 'new-item', ...data }
        created.push(row)
        return row
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      transactional: jest.fn(async (fn: (tem: unknown) => Promise<unknown>): Promise<unknown> => fn(em)),
      fork: jest.fn((): unknown => em),
    }
    const ctx = {
      container: { resolve: jest.fn((name: string) => (name === 'dataEngine' ? {} : em)) },
      auth: { tenantId: TENANT, orgId: ORG },
      selectedOrganizationId: ORG,
      organizationIds: [ORG],
      organizationScope: null,
    }
    return { ctx, created }
  }

  it('ends the item and creates a copy with the new price, keeping everything else', async () => {
    const record: Record<string, unknown> = {
      id: ITEM,
      tenantId: TENANT,
      organizationId: ORG,
      billAccountId: 'acc',
      type: 'recurring',
      isActive: true,
      deletedAt: null,
      billStartDate: '2026-11-01',
      billEndDate: null,
      description: 'Plan',
      rateJson: { unit_price: 49 },
      chargeTiming: 'in_arrears',
      prorate: false,
      taxRate: '23',
      priceBasis: 'gross',
      sourceRef: 'cpq-123',
      subscriptionId: 'sub-1',
    }
    const { ctx, created } = env(record)
    const result = await changeItemPriceCommand.execute(
      { tenantId: TENANT, organizationId: ORG, id: ITEM, effectiveDate: d('2026-12-15'), unitPrice: 59 },
      ctx as never,
    )
    expect(result).toEqual({ previousItemId: ITEM, newItemId: 'new-item' })
    expect(iso(record.billEndDate as Date)).toBe('2026-12-14')
    expect(created[0]).toMatchObject({
      billAccountId: 'acc',
      rateJson: { unit_price: 59 },
      chargeTiming: 'in_arrears',
      prorate: false,
      taxRate: '23',
      priceBasis: 'gross',
      subscriptionId: 'sub-1',
      sourceRef: null,
      billedToDate: null,
    })
    expect(iso(created[0].billStartDate as Date)).toBe('2026-12-15')
  })

  it('maps planning errors to 422 with the code', async () => {
    const { ctx } = env({ id: ITEM, type: 'one_time', isActive: true, deletedAt: null, billStartDate: '2026-11-01' })
    await expect(
      changeItemPriceCommand.execute(
        { tenantId: TENANT, organizationId: ORG, id: ITEM, effectiveDate: d('2026-12-15'), unitPrice: 59 },
        ctx as never,
      ),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.price_change_recurring_only' } })
  })

  describe('credit reason (Part 2)', () => {
    const billed = (): Record<string, unknown> => ({
      id: ITEM,
      tenantId: TENANT,
      organizationId: ORG,
      billAccountId: 'acc',
      type: 'recurring',
      isActive: true,
      deletedAt: null,
      billStartDate: '2026-11-01',
      billEndDate: null,
      billedToDate: '2026-12-31',
      description: 'Plan',
      rateJson: { unit_price: 49 },
      prorate: true,
    })

    it('requires a reason when the change credits billed days', async () => {
      const { ctx } = env(billed())
      await expect(
        changeItemPriceCommand.execute(
          { tenantId: TENANT, organizationId: ORG, id: ITEM, effectiveDate: d('2026-12-15'), unitPrice: 59 },
          ctx as never,
        ),
      ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.credit_reason_required' } })
    })

    it('stores the operator reason on the ended item, not on the copy', async () => {
      const record = billed()
      const { ctx, created } = env(record)
      await changeItemPriceCommand.execute(
        {
          tenantId: TENANT,
          organizationId: ORG,
          id: ITEM,
          effectiveDate: d('2026-12-15'),
          unitPrice: 59,
          creditReason: 'Loyalty discount from 15 Dec',
        },
        ctx as never,
      )
      expect(record.creditReason).toEqual({ kind: 'text', text: 'Loyalty discount from 15 Dec' })
      expect(created[0].creditReason).toBeUndefined()
    })

    it('needs no reason when nothing was billed past the date, or proration is off', async () => {
      for (const overrides of [{ billedToDate: '2026-12-14' }, { prorate: false }]) {
        const record: Record<string, unknown> = { ...billed(), ...overrides }
        const { ctx } = env(record)
        await changeItemPriceCommand.execute(
          { tenantId: TENANT, organizationId: ORG, id: ITEM, effectiveDate: d('2026-12-15'), unitPrice: 59 },
          ctx as never,
        )
        expect(record.creditReason).toBeNull()
      }
    })
  })
})
