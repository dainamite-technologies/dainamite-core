import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { CpqBillingOrderSetupService, OrderSetupError } from '../../services/orderSetupService'
import { CpqBillingOrderSetup } from '../../data/entities'

const scope = { tenantId: '44444444-4444-4444-8444-444444444444', organizationId: '55555555-5555-4555-8555-555555555555' }
const ORDER = '22222222-2222-4222-8222-222222222222'
const LINE = '11111111-1111-4111-8111-111111111111'
const ACCOUNT = '33333333-3333-4333-8333-333333333333'
const MODIFIED = '66666666-6666-4666-8666-666666666666'

type Row = CpqBillingOrderSetup

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    customerId: 'cust-1',
    cpqStatus: 'draft',
    currencyCode: 'COP',
    quoteType: 'new',
    lines: [
      { lineId: LINE, offeringName: 'Fiber', action: 'add', parentLineId: null, startDate: null, nrcTotal: 0, mrcTotal: 100 },
      { lineId: 'zero', offeringName: 'Free router', action: 'add', parentLineId: LINE, startDate: null, nrcTotal: 0, mrcTotal: 0 },
      { lineId: MODIFIED, offeringName: 'Fiber 500', action: 'modify', parentLineId: null, startDate: null, nrcTotal: 0, mrcTotal: 80 },
    ],
    ...overrides,
  }
}

/**
 * Mock EM: one in-memory table for the setup rows plus billing accounts
 * (read by `BillingApiClient` through `findOne`).
 */
function setup(options: { order?: Record<string, unknown>; rows?: Row[]; accounts?: Array<Record<string, unknown>> } = {}) {
  const rows: Row[] = options.rows ?? []
  const accounts = options.accounts ?? []
  const matches = (record: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      value === null ? record[key] == null : record[key] === value,
    )
  const em = {
    fork: () => em,
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CpqBillingOrderSetup) return rows.find((row) => matches(row as never, where)) ?? null
      return accounts.find((a) => matches(a, where)) ?? null
    }),
    find: jest.fn(async () => []),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `row-${rows.length + 1}`, accountOverrides: {}, lineBillStarts: {}, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data }
      return row as unknown as Row
    }),
    persist: jest.fn((row: Row) => {
      rows.push(row)
    }),
    flush: jest.fn(async () => undefined),
  }
  const cpqOrderService = {
    getOrder: jest.fn(async () => {
      if (options.order === null) throw Object.assign(new Error('Order not found'), { status: 404 })
      return order(options.order)
    }),
    getOrderCustomerFields: jest.fn(async () => ({
      customerName: 'Test S.A.S.',
      invoiceEmail: 'ap@test.co',
      invoiceAddress: { line1: 'Calle 93', city: 'Bogotá', postalCode: '110221', country: 'CO' },
    })),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'cpqOrderService') return cpqOrderService
      if (name === 'em') return em
      if (name === 'commandBus') return {}
      throw new Error(`unexpected resolve ${name}`)
    },
  }
  const service = new CpqBillingOrderSetupService({ em: em as never, container: container as never })
  return { service, rows, em }
}

describe('CpqBillingOrderSetupService.getView', () => {
  it('returns customer defaults and only billable lines, editable for a draft new-sale order', async () => {
    const { service } = setup()
    const view = await service.getView(scope, ORDER)
    expect(view.editable).toBe(true)
    expect(view.setup).toBeNull()
    expect(view.defaults.account).toMatchObject({
      name: 'Test S.A.S.',
      invoiceEmail: 'ap@test.co',
      invoiceAddress: { line1: 'Calle 93', city: 'Bogotá', postal_code: '110221', country: 'CO' },
      billCycle: 'monthly',
      billCycleInterval: 1,
      billCycleDay: '1',
    })
    expect(view.defaults.account).not.toHaveProperty('billCycleAnchor')
    // A new sale bills every billable line; only ARC orders narrow to added lines.
    expect(view.defaults.lines.map((l) => l.lineId)).toEqual([LINE, MODIFIED])
  })

  it('is read-only once the order is active', async () => {
    const { service } = setup({ order: { cpqStatus: 'active' } })
    expect((await service.getView(scope, ORDER)).editable).toBe(false)
  })

  it('maps a missing CPQ order to 404', async () => {
    const { service } = setup({ order: null as never })
    await expect(service.getView(scope, ORDER)).rejects.toMatchObject({ status: 404 })
  })
})

describe('CpqBillingOrderSetupService.save / restore', () => {
  it('creates the setup and returns before = null for the undo log', async () => {
    const { service, rows } = setup()
    const { before, after } = await service.save(scope, ORDER, {
      accountMode: 'new',
      accountOverrides: { name: 'Sede Norte' },
      lineBillStarts: { [LINE]: '2026-12-15' },
    })
    expect(before).toBeNull()
    expect(after).toMatchObject({
      orderId: ORDER,
      customerId: 'cust-1',
      currencyCode: 'COP',
      accountMode: 'new',
      accountOverrides: { name: 'Sede Norte' },
      defaultBillStartDate: null,
      lineBillStarts: { [LINE]: '2026-12-15' },
    })
    expect(rows).toHaveLength(1)
  })

  it('undo of a create soft-deletes the row', async () => {
    const { service, rows } = setup()
    const { after } = await service.save(scope, ORDER, { accountMode: 'new' })
    await service.restore(scope, null, after)
    expect(rows[0].deletedAt).toBeInstanceOf(Date)
  })

  it('undo of an update puts the previous values back', async () => {
    const { service, rows } = setup()
    await service.save(scope, ORDER, { accountMode: 'new', defaultBillStartDate: '2026-12-01' })
    const second = await service.save(scope, ORDER, { accountMode: 'new', defaultBillStartDate: '2027-01-01' })
    expect(second.before?.defaultBillStartDate).toBe('2026-12-01')
    await service.restore(scope, second.before, second.after)
    expect(rows[0].defaultBillStartDate).toBe('2026-12-01')
  })

  it('accepts only a usable existing account (422 otherwise)', async () => {
    const usable = { id: ACCOUNT, tenantId: scope.tenantId, organizationId: scope.organizationId, customerId: 'cust-1', currencyCode: 'COP', isActive: true, deletedAt: null }
    const ok = setup({ accounts: [usable] })
    await expect(ok.service.save(scope, ORDER, { accountMode: 'existing', billingAccountId: ACCOUNT })).resolves.toBeDefined()

    const usd = setup({ accounts: [{ ...usable, currencyCode: 'USD' }] })
    await expect(
      usd.service.save(scope, ORDER, { accountMode: 'existing', billingAccountId: ACCOUNT }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('rejects lines that are not on the order (422)', async () => {
    const { service } = setup()
    await expect(
      service.save(scope, ORDER, { accountMode: 'new', lineBillStarts: { '99999999-9999-4999-8999-999999999999': '2026-12-01' } }),
    ).rejects.toBeInstanceOf(OrderSetupError)
  })

  it('refuses changes once the order is active or the setup was applied (409)', async () => {
    const active = setup({ order: { cpqStatus: 'active' } })
    await expect(active.service.save(scope, ORDER, { accountMode: 'new' })).rejects.toMatchObject({ status: 409 })

    const applied = setup()
    await applied.service.save(scope, ORDER, { accountMode: 'new' })
    applied.rows[0].appliedAt = new Date()
    await expect(applied.service.save(scope, ORDER, { accountMode: 'new' })).rejects.toMatchObject({ status: 409 })
    await expect(
      applied.service.restore(scope, null, { id: applied.rows[0].id } as never),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('requires accountMode for a new-sale order (422)', async () => {
    const { service } = setup()
    await expect(service.save(scope, ORDER, {})).rejects.toMatchObject({ status: 422 })
  })

  it('ARC (phase 2): stores bill starts of added lines only and ignores account fields', async () => {
    const { service } = setup({ order: { quoteType: 'amend' } })
    const { after } = await service.save(scope, ORDER, {
      accountMode: 'new',
      accountOverrides: { name: 'ignored' },
      defaultBillStartDate: '2026-12-01',
      lineBillStarts: { [LINE]: '2026-12-15' },
    })
    expect(after).toMatchObject({
      accountMode: 'existing',
      billingAccountId: null,
      accountOverrides: {},
      defaultBillStartDate: '2026-12-01',
      lineBillStarts: { [LINE]: '2026-12-15' },
    })
  })

  it('ARC: a modified line gets no bill start (422) and is not offered', async () => {
    const { service } = setup({ order: { quoteType: 'renew' } })
    await expect(
      service.save(scope, ORDER, { lineBillStarts: { [MODIFIED]: '2027-01-01' } }),
    ).rejects.toMatchObject({ status: 422 })
    const view = await service.getView(scope, ORDER)
    expect(view.editable).toBe(true)
    expect(view.defaults.lines.map((l) => l.lineId)).toEqual([LINE])
  })

  it('a cancel order has nothing to bill (409, read-only)', async () => {
    const { service } = setup({ order: { quoteType: 'cancel' } })
    await expect(service.save(scope, ORDER, {})).rejects.toMatchObject({ status: 409 })
    expect((await service.getView(scope, ORDER)).editable).toBe(false)
  })
})

describe('CpqBillingOrderSetupService.markApplied', () => {
  it('creates a row when no setup was saved, so a re-fired event reuses the account', async () => {
    const { service, rows } = setup()
    await service.markApplied(scope, {
      orderId: ORDER,
      customerId: 'cust-1',
      currencyCode: 'cop',
      billingAccountId: ACCOUNT,
      accountMode: 'new',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ appliedBillingAccountId: ACCOUNT, currencyCode: 'COP' })
    expect(rows[0].appliedAt).toBeInstanceOf(Date)
  })
})

describe('concurrent create race (review follow-up #2)', () => {
  function loseCreateRaceOnce(ctx: ReturnType<typeof setup>, winner: Partial<Row>) {
    let raced = false
    ctx.em.flush.mockImplementation(async () => {
      if (raced) return undefined
      raced = true
      // Another request inserted the row between our find and our flush.
      ctx.rows.splice(0, ctx.rows.length, {
        id: 'winner',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        cpqOrderId: ORDER,
        customerId: 'cust-1',
        currencyCode: 'COP',
        accountMode: 'new',
        billingAccountId: null,
        accountOverrides: {},
        defaultBillStartDate: null,
        lineBillStarts: {},
        appliedAt: null,
        appliedBillingAccountId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...winner,
      } as unknown as Row)
      throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'))
    })
  }

  it('save: the loser retries and overwrites the winner (PUT = last writer wins), with before = winner', async () => {
    const ctx = setup()
    loseCreateRaceOnce(ctx, { defaultBillStartDate: '2026-12-01' })
    const { before, after } = await ctx.service.save(scope, ORDER, { accountMode: 'new', defaultBillStartDate: '2027-01-01' })
    expect(ctx.rows).toHaveLength(1)
    expect(after).toMatchObject({ id: 'winner', defaultBillStartDate: '2027-01-01' })
    expect(before).toMatchObject({ id: 'winner', defaultBillStartDate: '2026-12-01' })
  })

  it('save: a retry that finds the winner already applied still returns 409', async () => {
    const ctx = setup()
    loseCreateRaceOnce(ctx, { appliedAt: new Date() })
    await expect(ctx.service.save(scope, ORDER, { accountMode: 'new' })).rejects.toMatchObject({ status: 409 })
  })

  it('save: other database errors are not retried', async () => {
    const ctx = setup()
    ctx.em.flush.mockRejectedValueOnce(new Error('connection lost'))
    await expect(ctx.service.save(scope, ORDER, { accountMode: 'new' })).rejects.toThrow('connection lost')
    expect(ctx.em.flush).toHaveBeenCalledTimes(1)
  })

  it('markApplied: the loser retries, records its account and keeps the first appliedAt', async () => {
    const ctx = setup()
    const firstApplied = new Date('2026-11-15T10:00:00Z')
    loseCreateRaceOnce(ctx, { appliedAt: firstApplied, appliedBillingAccountId: 'acc-first' })
    await ctx.service.markApplied(scope, {
      orderId: ORDER,
      customerId: 'cust-1',
      currencyCode: 'COP',
      billingAccountId: ACCOUNT,
      accountMode: 'existing',
    })
    expect(ctx.rows).toHaveLength(1)
    expect(ctx.rows[0]).toMatchObject({ id: 'winner', appliedBillingAccountId: ACCOUNT, appliedAt: firstApplied })
  })
})
