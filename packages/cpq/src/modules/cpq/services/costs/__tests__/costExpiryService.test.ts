import { CpqCostExpiryService, addDays, daysBetween } from '../costExpiryService'
import { CpqQuoteLineCost } from '../../../data/entities'
import { NOW, SCOPE, lineRow, run, setup, type Row } from './_helpers/expiryHarness'

describe('date helpers', () => {
  it('adds and diffs UTC calendar days', () => {
    expect(addDays('2026-11-06', 14)).toBe('2026-11-20')
    expect(daysBetween('2026-11-06', '2026-11-20')).toBe(14)
    expect(daysBetween('2026-11-20', '2026-11-18')).toBe(-2)
  })
})

describe('CpqCostExpiryService', () => {
  it('warns once per (line, valid_until) over two runs: one ledger row, one event, one notification', async () => {
    const t = setup()
    expect(await run(t.service, '2026-11-06')).toEqual({ inserted: 1, reEmitted: 0 })
    expect(await run(t.service, '2026-11-07')).toEqual({ inserted: 0, reEmitted: 0 })
    expect(t.ledger).toHaveLength(1)
    expect(t.ledger[0]).toMatchObject({ validUntil: '2026-11-20', leadDays: 14, expired: false, emittedAt: NOW })
    expect(t.emit).toHaveBeenCalledTimes(1)
    expect(t.createBatch).toHaveBeenCalledTimes(1)
    expect(t.emit).toHaveBeenCalledWith('cpq.quote.cost_expiring', expect.objectContaining({
      tenantId: 'tenant', organizationId: 'org', warningId: 'w-1', quoteId: 'qc-1', quoteLineId: 'line-1', costLineId: 'cost-1', costKey: 'tail', chargeCode: 'mrc',
      validUntil: '2026-11-20', daysLeft: 14, expired: false, leadDays: 14,
    }), { persistent: true })
  })

  it('sends one batch to the cost managers with the quote link, never an amount or supplier', async () => {
    const t = setup()
    await run(t.service, '2026-11-06')
    const [input, ctx] = t.createBatch.mock.calls[0] as unknown as [Record<string, any>, unknown]
    expect(input).toMatchObject({
      type: 'cpq.cost.expiring', recipientUserIds: ['manager'], linkHref: '/backend/cpq/quotes/qc-1#costs',
      titleVariables: { quoteNumber: 'Q-2026-1' }, bodyVariables: { costName: 'Tail circuit', validUntil: '2026-11-20' }, bodyKey: 'cpq.notifications.costExpiring.body',
    })
    expect(ctx).toEqual({ tenantId: 'tenant', organizationId: 'org' })
    const serialized = JSON.stringify([t.emit.mock.calls, t.createBatch.mock.calls])
    expect(serialized).not.toMatch(/7777|SecretSupplier|unitAmount|supplierName|amount/i)
  })

  it('catches up three missed days without duplicates, flagging already expired lines', async () => {
    const t = setup({ lines: [
      lineRow({ id: 'a', validUntil: '2026-11-03' }), lineRow({ id: 'b', validUntil: '2026-11-18' }), lineRow({ id: 'c', validUntil: '2026-11-19' }), lineRow({ id: 'late', validUntil: '2026-12-31' }),
    ] })
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 3 })
    expect(t.ledger.map((row) => [row.quoteLineCostId, row.expired])).toEqual([['a', true], ['b', false], ['c', false]])
    expect(await run(t.service, '2026-11-09')).toMatchObject({ inserted: 0 })
    const expired = t.emit.mock.calls.map((call) => call[1] as Row).find((payload) => payload.costLineId === 'a')!
    expect(expired).toMatchObject({ expired: true, daysLeft: -3 })
    expect(t.createBatch.mock.calls.some((call) => (call[0] as Row).bodyKey === 'cpq.notifications.costExpiring.bodyExpired')).toBe(true)
  })

  it('warns again at the new due date after a validity extension', async () => {
    const t = setup()
    await run(t.service, '2026-11-06')
    t.data.get(CpqQuoteLineCost)![0].validUntil = '2026-12-31'
    expect(await run(t.service, '2026-11-20')).toMatchObject({ inserted: 0 })
    expect(await run(t.service, '2026-12-17')).toMatchObject({ inserted: 1 })
    expect(t.ledger.map((row) => row.validUntil)).toEqual(['2026-11-20', '2026-12-31'])
    expect(t.emit).toHaveBeenCalledTimes(2)
  })

  it('excludes rejected and cancelled quotes (SQL status filter) and converted quotes, but includes accepted', async () => {
    const quote = (id: string, status: string) => ({ id, quoteId: 'sq-1', organizationId: 'org', tenantId: 'tenant', cpqStatus: status, deletedAt: null })
    const t = setup({
      quotes: [quote('q-rej', 'rejected'), quote('q-can', 'cancelled'), quote('q-acc', 'accepted'), quote('q-ord', 'accepted'), quote('q-sent', 'sent')],
      lines: [
        lineRow({ id: 'rej', quoteConfigurationId: 'q-rej' }), lineRow({ id: 'can', quoteConfigurationId: 'q-can' }), lineRow({ id: 'acc', quoteConfigurationId: 'q-acc' }),
        lineRow({ id: 'ord', quoteConfigurationId: 'q-ord' }), lineRow({ id: 'sent', quoteConfigurationId: 'q-sent' }),
      ],
      orders: [{ id: 'order-1', sourceQuoteId: 'q-ord', organizationId: 'org', tenantId: 'tenant', deletedAt: null }],
    })
    await run(t.service, '2026-11-06')
    expect(t.ledger.map((row) => row.quoteLineCostId).sort()).toEqual(['acc', 'sent'])
  })

  it('excludes margin-only, unconfirmed, deleted, no-validity and other-tenant lines', async () => {
    const t = setup({ lines: [
      lineRow({ id: 'm', role: 'margin_only' }), lineRow({ id: 'e', valueStatus: 'estimated' }), lineRow({ id: 'n', valueStatus: 'none' }),
      lineRow({ id: 'd', deletedAt: new Date() }), lineRow({ id: 'v', validUntil: null }), lineRow({ id: 'x', tenantId: 'other' }), lineRow({ id: 'o', organizationId: 'other-org' }),
      lineRow({ id: 'ok' }),
    ] })
    await run(t.service, '2026-11-06')
    expect(t.ledger.map((row) => row.quoteLineCostId)).toEqual(['ok'])
  })

  it('is a no-op when the cost-plus toggle is off', async () => {
    const t = setup({ toggle: false })
    expect(await run(t.service, '2026-11-06')).toEqual({ inserted: 0, reEmitted: 0, disabled: true })
    expect(t.ledger).toHaveLength(0)
    expect(t.emit).not.toHaveBeenCalled()
  })

  it('reads the lead days from the tenant toggle unless given, and falls back to 14', async () => {
    const t = setup()
    t.toggles.getNumberConfig.mockResolvedValueOnce({ ok: true, value: 3 })
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 0 })
    expect(t.toggles.getNumberConfig).toHaveBeenCalledWith('cpq.cost_expiry_lead_days', 'tenant')
    t.toggles.getNumberConfig.mockResolvedValueOnce({ ok: false } as never)
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 1 })
    expect(t.ledger[0].leadDays).toBe(14)
    expect(await run(t.service, '2026-11-06', { leadDays: 30 })).toMatchObject({ inserted: 0 })
  })

  it('re-emits a stale un-emitted row once, and leaves a fresh one alone', async () => {
    const stale = { id: 'w-old', organizationId: 'org', tenantId: 'tenant', quoteLineCostId: 'cost-1', quoteId: 'qc-1', quoteLineId: 'line-1', validUntil: '2026-11-20',
      leadDays: 14, expired: false, emittedAt: null, createdAt: new Date(NOW.getTime() - 11 * 60_000) }
    const fresh = { ...stale, id: 'w-new', quoteLineCostId: 'cost-2', createdAt: new Date(NOW.getTime() - 2 * 60_000) }
    const t = setup({ ledger: [stale, fresh], lines: [lineRow(), lineRow({ id: 'cost-2' })] })
    expect(await run(t.service, '2026-11-06')).toEqual({ inserted: 0, reEmitted: 1 })
    expect(t.emit).toHaveBeenCalledTimes(1)
    expect(t.emit.mock.calls[0][1]).toMatchObject({ warningId: 'w-old', costLineId: 'cost-1' })
    expect(stale.emittedAt).toEqual(NOW)
    expect(fresh.emittedAt).toBeNull()
    expect(await run(t.service, '2026-11-06')).toMatchObject({ reEmitted: 0 })
    expect(t.emit).toHaveBeenCalledTimes(1)
  })

  it('leaves a row un-stamped when delivery fails, so the next run retries it', async () => {
    const t = setup({ emitFails: true })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 1 })
    expect(t.ledger[0].emittedAt).toBeNull()
    const later = new Date(NOW.getTime() + 11 * 60_000)
    t.emit.mockImplementation(async () => undefined)
    expect(await t.service.run({ scope: SCOPE, today: '2026-11-06', now: later })).toEqual({ inserted: 0, reEmitted: 1 })
    expect(t.ledger[0].emittedAt).toEqual(later)
  })

  it('pages the candidates in bounded batches without skipping or repeating a line', async () => {
    const lines = ['a', 'b', 'c', 'd', 'e'].map((id, i) => lineRow({ id, validUntil: `2026-11-1${i}` }))
    const t = setup({ lines, batchSize: 2 })
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 5 })
    expect(t.ledger.map((row) => row.quoteLineCostId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(t.em.find.mock.calls.filter((call: unknown[]) => call[0] === CpqQuoteLineCost).every((call: any[]) => call[2].limit === 2)).toBe(true)
  })

  it('scopes the candidate query to the tenant and organization and orders it for the partial index', async () => {
    const t = setup()
    await run(t.service, '2026-11-06')
    const call = t.em.find.mock.calls.find((c: unknown[]) => c[0] === CpqQuoteLineCost)!
    expect(call[1]).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null, role: 'price_basis', valueStatus: 'confirmed', validUntil: { $ne: null, $lte: '2026-11-20' } })
    expect(call[2].orderBy).toEqual([{ validUntil: 'asc' }, { id: 'asc' }])
  })

  it('dry run counts without writing, emitting or notifying', async () => {
    const t = setup()
    expect(await run(t.service, '2026-11-06', { dryRun: true })).toEqual({ inserted: 1, reEmitted: 0 })
    expect(t.ledger).toHaveLength(0)
    expect(t.emit).not.toHaveBeenCalled()
    expect(t.createBatch).not.toHaveBeenCalled()
  })

  it('emits without a notification when the notifications peer is absent', async () => {
    const t = setup()
    const service = new CpqCostExpiryService({ em: t.em as never, featureTogglesService: t.toggles as never, emit: t.emit as never, notify: null })
    await run(service, '2026-11-06')
    expect(t.emit).toHaveBeenCalledTimes(1)
    expect(t.ledger[0].emittedAt).toEqual(NOW)
  })
})
