import { CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride } from '../../../data/entities'
import { CpqQuoteCostService } from '../quoteCostService'
import { fullCostView, redactedCostView } from '../quoteCostView'

const SCOPE = { organizationId: 'org', tenantId: 'ten' }
const SENTINEL = '7777.77'
const NOW = new Date()
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

const costRow = (patch: Record<string, unknown> = {}) => ({
  id: 'cost-1', ...SCOPE, quoteConfigurationId: 'q1', quoteLineId: 'l1', costKey: 'tail', name: 'Tail circuit', chargeCode: 'mrc', role: 'price_basis',
  origin: 'catalog', costType: 'mrc', source: 'on_request', costModel: 'flat', valueOrigin: 'catalog', valueStatus: 'estimated',
  unitAmount: SENTINEL, instanceAmount: SENTINEL, currencyCode: 'EUR', supplierName: 'Secret Carrier', supplierQuoteRef: 'REF-1', note: 'secret note',
  sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 2, requestedAt: daysAgo(30), proposedAmount: null, proposedAnswer: null,
  requestSupplierId: 'sup-1', requestSupplierName: 'Request Supplier', errorCode: null, validUntil: null, deletedAt: null, ...patch,
})

function readService(rows: Array<Record<string, unknown>>, line: Record<string, unknown> = {}, threshold: number | null = 5) {
  const quote = { id: 'q1', quoteId: 'sales', cpqStatus: 'ready', quoteType: 'new', currencyCode: 'EUR', pricingRevision: 3 }
  const lineConfig = { quoteLineId: 'l1', ...SCOPE, quoteConfigurationId: 'q1', quantity: '1', charges: [], termMonths: 12, parentLineId: null, configuration: {}, action: 'add', offeringId: 'off', deletedAt: null, ...line }
  const em: Record<string, unknown> = {
    fork: () => em,
    findOne: jest.fn(async (entity: unknown) => (entity === CpqQuoteConfiguration ? quote : null)),
    find: jest.fn(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? [lineConfig] : entity === CpqQuoteLineCost ? rows : entity === CpqQuoteMarkupOverride ? [] : [])),
    count: jest.fn(async () => 0),
  }
  return new CpqQuoteCostService({
    em: em as never, costService: { enabled: async () => true }, quotingService: { recalculateLockedQuote: async () => ({}) } as never,
    ...(threshold === null ? {} : { featureTogglesService: { getNumberConfig: async () => ({ ok: true, value: threshold }) } as never }),
  })
}

describe('quote costs read: sourcing projection', () => {
  it('the status-only projection carries sourcing statuses but no amount, supplier or note', async () => {
    const read = await readService([costRow({ proposedAmount: SENTINEL, proposedAnswer: { unitAmount: 7777.77, supplierQuoteRef: 'REF-2' } })]).read('q1', SCOPE, false)
    const [cost] = read.lines[0].costs as Array<Record<string, unknown>>
    expect(cost).toMatchObject({ sourcingStatus: 'requested', requestSeq: 2, hasAnswerPending: true, overdue: true, requestEligible: true })
    expect(typeof cost.requestedAt).toBe('string')
    const text = JSON.stringify(read)
    for (const secret of [SENTINEL, 'Secret Carrier', 'secret note', 'REF-1', 'REF-2', 'Request Supplier', 'req-1', 'sup-1']) expect(text).not.toContain(secret)
  })

  it('the full projection adds the request id, answer, proposal and request supplier for cost holders', async () => {
    const proposal = { unitAmount: 310, currencyCode: 'EUR' }
    const read = await readService([costRow({ proposedAmount: '310', proposedAnswer: proposal, answeredAt: NOW })]).read('q1', SCOPE, true)
    expect(read.lines[0].costs[0]).toMatchObject({
      costRequestId: 'req-1', proposedAnswer: proposal, hasAnswerPending: true, requestSupplierId: 'sup-1', requestSupplierName: 'Request Supplier', unitAmount: SENTINEL,
    })
  })

  it('overdue follows the tenant threshold in working days and only holds for open requests', async () => {
    const fresh = await readService([costRow({ requestedAt: NOW })]).read('q1', SCOPE, false)
    expect(fresh.lines[0].costs[0]).toMatchObject({ overdue: false })
    const old = await readService([costRow({ requestedAt: daysAgo(30), sourcingStatus: 'answered' })]).read('q1', SCOPE, false)
    expect(old.lines[0].costs[0]).toMatchObject({ overdue: false })
    const noToggle = await readService([costRow()], {}, null).read('q1', SCOPE, false)
    expect(noToggle.lines[0].costs[0]).toMatchObject({ overdue: false })
  })

  it('flags Cancel lines and frozen-unpriceable cost lines as not eligible for a request (Q14)', async () => {
    const cancelRead = await readService([costRow()], { action: 'cancel' }).read('q1', SCOPE, false)
    // quote type "new": a cancel action is not a termination line
    expect(cancelRead.lines[0].costs[0]).toMatchObject({ requestEligible: true })
    const arcQuote = readService([costRow()], { action: 'cancel' })
    const em = (arcQuote as unknown as { deps: { em: { findOne: jest.Mock } } }).deps.em
    em.findOne.mockImplementation(async (entity: unknown) => (entity === CpqQuoteConfiguration ? { id: 'q1', quoteId: 'sales', cpqStatus: 'ready', quoteType: 'cancel', currencyCode: 'EUR', pricingRevision: 1 } : null))
    expect((await arcQuote.read('q1', SCOPE, false)).lines[0].costs[0]).toMatchObject({ requestEligible: false })
  })

  it('views default to no overdue / eligibility info when no context is given', () => {
    expect(redactedCostView(costRow() as never)).toMatchObject({ overdue: false, sourcingStatus: 'requested' })
    expect(redactedCostView(costRow() as never)).not.toHaveProperty('requestEligible')
    expect(JSON.stringify(redactedCostView(costRow({ proposedAmount: SENTINEL }) as never))).not.toContain(SENTINEL)
    expect(fullCostView(costRow() as never, { requestEligible: false })).toMatchObject({ requestEligible: false })
  })
})
