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
