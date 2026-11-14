import type { EntityManager } from '@mikro-orm/postgresql'
import { emitCpqEvent as emitCpqEventImport } from '../../events'
import { captureQuoteEventState, emitQuoteWriteEvents } from '../priceAdjustments/quotePricingEvents'
import { withQuotePricingWrite } from '../priceAdjustments/quotePricingWrite'

jest.mock('../../events', () => ({ emitCpqEvent: jest.fn().mockResolvedValue(undefined) }))
const emitCpqEvent = emitCpqEventImport as unknown as jest.Mock

const scope = { tenantId: 'tenant', organizationId: 'org' }
const error = (status: number, message: string) => Object.assign(new Error(message), { status })

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1', quoteId: 'sales-1', tenantId: 'tenant', organizationId: 'org', cpqStatus: 'ready', quoteType: 'new',
    currencyCode: 'USD', pricingRevision: 3,
    pricingSummary: {
      snapshotHash: 'hash-a', dealValue: { list: 1200, standard: 1000, offer: 800 },
      discountDepth: { rule: 1 / 6, manual: 0.2, total: 1 / 3, maxLineManual: 0.2 }, hasTimeBasedAdjustments: false,
    } as Record<string, unknown>,
    ...overrides,
  }
}

function writeHarness(locked: ReturnType<typeof quote>) {
  const transaction = { findOne: jest.fn().mockResolvedValue(locked), flush: jest.fn().mockResolvedValue(undefined) }
  const isolated = { transactional: jest.fn().mockImplementation(async (fn: (em: typeof transaction) => Promise<unknown>) => fn(transaction)) }
  return { em: { fork: jest.fn().mockReturnValue(isolated) } as unknown as EntityManager, isolated }
}

const emitted = () => emitCpqEvent.mock.calls.map(([id]) => id)

beforeEach(() => emitCpqEvent.mockClear())

describe('emitQuoteWriteEvents — exact payload shapes (characterization)', () => {
  const snapshot = {
    tenantId: 'tenant', organizationId: 'org', quoteId: 'cfg-1', quoteType: 'new', cpqStatus: 'in_approval',
    currencyCode: 'USD', pricingRevision: 3, snapshotHash: 'hash-a',
    dealValue: { list: 1200, standard: 1000, offer: 800 },
    discountDepth: { rule: 1 / 6, manual: 0.2, total: 1 / 3, maxLineManual: 0.2 },
    hasTimeBasedAdjustments: false, occurredAt: expect.any(String),
  }

  it('pins the pricing_changed payload key set exactly', async () => {
    await emitQuoteWriteEvents({ snapshotHash: 'hash-0', cpqStatus: 'in_approval' }, quote({ cpqStatus: 'in_approval' }), { pricingCause: 'recalculate' }, emitCpqEvent)
    expect(emitCpqEvent).toHaveBeenCalledTimes(1)
    expect(emitCpqEvent.mock.calls[0]).toEqual(['cpq.quote.pricing_changed', { ...snapshot, cause: 'recalculate' }])
    expect(Object.keys(emitCpqEvent.mock.calls[0][1]).sort()).toEqual([
      'cause', 'cpqStatus', 'currencyCode', 'dealValue', 'discountDepth', 'hasTimeBasedAdjustments', 'occurredAt',
      'organizationId', 'pricingRevision', 'quoteId', 'quoteType', 'snapshotHash', 'tenantId',
    ])
  })

  it('pins the status_changed payload key set exactly', async () => {
    await emitQuoteWriteEvents({ snapshotHash: 'hash-a', cpqStatus: 'ready' }, quote({ cpqStatus: 'in_approval' }),
      { pricingCause: 'line', statusCause: 'manual', actorUserId: 'user-1' }, emitCpqEvent)
    expect(emitCpqEvent.mock.calls).toEqual([['cpq.quote.status_changed', {
      ...snapshot, fromStatus: 'ready', toStatus: 'in_approval', cause: 'manual', actorUserId: 'user-1',
    }]])
    expect(Object.keys(emitCpqEvent.mock.calls[0][1]).sort()).toEqual([
      'actorUserId', 'cause', 'cpqStatus', 'currencyCode', 'dealValue', 'discountDepth', 'fromStatus', 'hasTimeBasedAdjustments',
      'occurredAt', 'organizationId', 'pricingRevision', 'quoteId', 'quoteType', 'snapshotHash', 'tenantId', 'toStatus',
    ])
  })

  it('defaults a legacy summary to an empty hash and zeroed deal value in the snapshot', async () => {
    await emitQuoteWriteEvents(null, quote({ pricingSummary: { snapshotHash: 'h' } }), { pricingCause: 'clone' }, emitCpqEvent)
    expect(emitCpqEvent.mock.calls[0][1]).toMatchObject({
      snapshotHash: 'h', dealValue: { list: 0, standard: 0, offer: 0 },
      discountDepth: { rule: null, manual: null, total: null, maxLineManual: null }, hasTimeBasedAdjustments: false,
    })
  })
})

describe('emitQuoteWriteEvents', () => {
  it('emits one pricing_changed with the pricing snapshot when the stored hash changes', async () => {
    const q = quote()
    const before = captureQuoteEventState({ ...q, pricingSummary: { snapshotHash: 'hash-0' } })
    await emitQuoteWriteEvents(before, q, { pricingCause: 'adjustment' }, emitCpqEvent)
    expect(emitCpqEvent).toHaveBeenCalledTimes(1)
    expect(emitCpqEvent).toHaveBeenCalledWith('cpq.quote.pricing_changed', expect.objectContaining({
      tenantId: 'tenant', organizationId: 'org', quoteId: 'cfg-1', quoteType: 'new', cpqStatus: 'ready',
      currencyCode: 'USD', pricingRevision: 3, snapshotHash: 'hash-a',
      dealValue: { list: 1200, standard: 1000, offer: 800 },
      discountDepth: expect.objectContaining({ manual: 0.2 }), hasTimeBasedAdjustments: false,
      cause: 'adjustment', occurredAt: expect.any(String),
    }))
  })

  it('emits nothing for an unchanged hash and status (no-op recalculation, reason edit)', async () => {
    const q = quote()
    await emitQuoteWriteEvents(captureQuoteEventState(q), q, { pricingCause: 'recalculate' }, emitCpqEvent)
    expect(emitCpqEvent).not.toHaveBeenCalled()
  })

  it('stores a legacy baseline without a pricing signal', async () => {
    const q = quote()
    await emitQuoteWriteEvents({ snapshotHash: null, cpqStatus: 'ready' }, q, { pricingCause: 'recalculate' }, emitCpqEvent)
    expect(emitCpqEvent).not.toHaveBeenCalled()
  })

  it('emits status_changed with cause auto for a recalculation-driven transition', async () => {
    const q = quote({ cpqStatus: 'incomplete' })
    await emitQuoteWriteEvents({ snapshotHash: 'hash-a', cpqStatus: 'ready' }, q, { pricingCause: 'line' }, emitCpqEvent)
    expect(emitted()).toEqual(['cpq.quote.status_changed'])
    expect(emitCpqEvent.mock.calls[0][1]).toMatchObject({ fromStatus: 'ready', toStatus: 'incomplete', cause: 'auto', actorUserId: null })
  })

  it('emits both signals and carries the actor for a manual transition', async () => {
    const q = quote({ cpqStatus: 'in_approval' })
    await emitQuoteWriteEvents({ snapshotHash: 'hash-0', cpqStatus: 'ready' }, q,
      { pricingCause: 'recalculate', statusCause: 'manual', actorUserId: 'user-1' }, emitCpqEvent)
    expect(emitted()).toEqual(['cpq.quote.pricing_changed', 'cpq.quote.status_changed'])
    expect(emitCpqEvent.mock.calls[1][1]).toMatchObject({ cause: 'manual', actorUserId: 'user-1', toStatus: 'in_approval' })
  })

  it('treats a new aggregate (clone) as a pricing change', async () => {
    await emitQuoteWriteEvents(null, quote(), { pricingCause: 'clone' }, emitCpqEvent)
    expect(emitted()).toEqual(['cpq.quote.pricing_changed'])
    expect(emitCpqEvent.mock.calls[0][1]).toMatchObject({ cause: 'clone' })
  })

  it('logs and swallows a dispatch failure so the committed write stands', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('bus down'))
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(emitQuoteWriteEvents({ snapshotHash: 'x', cpqStatus: 'new' }, quote(), { pricingCause: 'line' }, failing)).resolves.toBeUndefined()
    expect(failing).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('withQuotePricingWrite events', () => {
  it('emits after the transaction resolves, with the committed state', async () => {
    const locked = quote({ pricingSummary: { snapshotHash: 'hash-0' } })
    const { em, isolated } = writeHarness(locked)
    let committed = false
    isolated.transactional.mockImplementation(async (fn: (em: unknown) => Promise<unknown>) => {
      const value = await fn({ findOne: jest.fn().mockResolvedValue(locked), flush: jest.fn() })
      expect(emitCpqEvent).not.toHaveBeenCalled()
      committed = true
      return value
    })
    await withQuotePricingWrite(em, 'cfg-1', scope, async (_tx, q) => {
      q.pricingSummary = { ...quote().pricingSummary }
      return 'ok'
    }, error, undefined, undefined, { pricingCause: 'adjustment' })
    expect(committed).toBe(true)
    expect(emitted()).toEqual(['cpq.quote.pricing_changed'])
    expect(emitCpqEvent.mock.calls[0][1]).toMatchObject({ cause: 'adjustment', pricingRevision: 4 })
  })

  it('emits nothing when the write throws (rolled back)', async () => {
    const { em } = writeHarness(quote())
    await expect(withQuotePricingWrite(em, 'cfg-1', scope, async (_tx, q) => {
      q.cpqStatus = 'in_approval'
      throw new Error('boom')
    }, error)).rejects.toThrow('boom')
    expect(emitCpqEvent).not.toHaveBeenCalled()
  })

  it('emits nothing for a refused stale revision', async () => {
    const { em } = writeHarness(quote())
    await expect(withQuotePricingWrite(em, 'cfg-1', scope, async () => 'never', error, 1)).rejects.toMatchObject({ status: 409 })
    expect(emitCpqEvent).not.toHaveBeenCalled()
  })
})

describe('margin signals', () => {
  const signal = (overrides: Record<string, unknown> = {}) => ({
    previousMarginHash: 'm-0', marginHash: 'm-1', approvalInvalidated: false, contractMargin: 120.5, marginPercent: 12.05,
    costCoverage: 80, hasPendingCosts: false, hasEstimatedCosts: true, hasExpiredCosts: false,
    priceBasis: { hasPendingCosts: false, hasEstimatedCosts: true }, ...overrides,
  })

  it('emits margin_changed once, quote-level only, when the margin hash moved', async () => {
    await emitQuoteWriteEvents(captureQuoteEventState(quote({ cpqStatus: 'in_approval' })), quote({ cpqStatus: 'in_approval' }), { pricingCause: 'cost', actorUserId: 'u1' }, emitCpqEvent, signal({ approvalInvalidated: true }))
    expect(emitted()).toEqual(['cpq.quote.margin_changed'])
    expect(emitCpqEvent.mock.calls[0][1]).toEqual({
      tenantId: 'tenant', organizationId: 'org', quoteId: 'cfg-1', cpqStatus: 'in_approval', currencyCode: 'USD', pricingRevision: 3,
      previousMarginHash: 'm-0', marginHash: 'm-1', approvalInvalidated: true, contractMargin: 120.5, marginPercent: 12.05,
      costCoverage: 80, hasPendingCosts: false, hasEstimatedCosts: true, hasExpiredCosts: false, cause: 'cost', occurredAt: expect.any(String),
    })
  })

  it('emits no margin_changed for a confirmation or status-only change that left the hash alone', async () => {
    await emitQuoteWriteEvents(captureQuoteEventState(quote()), quote(), { pricingCause: 'cost' }, emitCpqEvent, signal({ marginHash: 'm-0' }))
    expect(emitCpqEvent).not.toHaveBeenCalled()
  })

  it('adds the cost flags to status_changed only when the quote carries costs', async () => {
    await emitQuoteWriteEvents({ snapshotHash: 'hash-a', cpqStatus: 'ready' }, quote({ cpqStatus: 'with_customer' }),
      { pricingCause: 'recalculate', statusCause: 'manual' }, emitCpqEvent, signal({ marginHash: 'm-0', priceBasis: { hasPendingCosts: true, hasEstimatedCosts: true } }))
    expect(emitCpqEvent.mock.calls[0][1]).toMatchObject({ hasPendingCosts: true, hasEstimatedCosts: true })
    expect(Object.keys(emitCpqEvent.mock.calls[0][1])).not.toContain('contractMargin')
    emitCpqEvent.mockClear()
    await emitQuoteWriteEvents({ snapshotHash: 'hash-a', cpqStatus: 'ready' }, quote({ cpqStatus: 'with_customer' }), { pricingCause: 'recalculate' }, emitCpqEvent)
    expect(emitCpqEvent.mock.calls[0][1]).not.toHaveProperty('hasPendingCosts')
  })

  it('status_changed flags come from price-basis costs only: a margin-only estimate does not make the quote indicative', async () => {
    const onlyMarginOnlyEstimate = signal({ marginHash: 'm-0', hasPendingCosts: true, hasEstimatedCosts: true, priceBasis: { hasPendingCosts: false, hasEstimatedCosts: false } })
    await emitQuoteWriteEvents({ snapshotHash: 'hash-a', cpqStatus: 'ready' }, quote({ cpqStatus: 'with_customer' }),
      { pricingCause: 'recalculate', statusCause: 'manual' }, emitCpqEvent, onlyMarginOnlyEstimate)
    expect(emitted()).toEqual(['cpq.quote.status_changed'])
    expect(emitCpqEvent.mock.calls[0][1]).toMatchObject({ hasPendingCosts: false, hasEstimatedCosts: false })
  })

  it('margin_changed keeps the margin flags (every cost line) next to a nullable previousMarginHash', async () => {
    await emitQuoteWriteEvents(captureQuoteEventState(quote()), quote(), { pricingCause: 'cost' }, emitCpqEvent,
      signal({ previousMarginHash: null, priceBasis: { hasPendingCosts: false, hasEstimatedCosts: false } }))
    expect(emitCpqEvent.mock.calls[0][1]).toMatchObject({ previousMarginHash: null, hasEstimatedCosts: true })
  })

  it('emits margin_changed after the commit through withQuotePricingWrite, and swallows a failing dispatch', async () => {
    const locked = quote()
    const { em } = writeHarness(locked)
    const tracker = { before: jest.fn().mockResolvedValue(undefined), after: jest.fn().mockResolvedValue(signal()) }
    await withQuotePricingWrite(em, 'cfg-1', scope, async () => 'ok', error, undefined, undefined, { pricingCause: 'cost' }, tracker)
    expect(tracker.before).toHaveBeenCalledTimes(1)
    expect(tracker.after).toHaveBeenCalledTimes(1)
    expect(emitted()).toEqual(['cpq.quote.margin_changed'])
    emitCpqEvent.mockClear()
    emitCpqEvent.mockRejectedValueOnce(new Error('bus down'))
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(withQuotePricingWrite(em, 'cfg-1', scope, async () => 'ok', error, undefined, undefined, { pricingCause: 'cost' }, tracker)).resolves.toBe('ok')
    log.mockRestore()
  })

  it('does not run the tracker for a refused stale revision', async () => {
    const { em } = writeHarness(quote())
    const tracker = { before: jest.fn(), after: jest.fn() }
    await expect(withQuotePricingWrite(em, 'cfg-1', scope, async () => 'never', error, 1, undefined, { pricingCause: 'cost' }, tracker)).rejects.toMatchObject({ status: 409 })
    expect(tracker.before).not.toHaveBeenCalled()
  })
})
