// Characterization (supplier-sourcing step 1): today's quote DELETE, frozen before step 9 adds the
// cost-request cancellation side effect. Everything here must stay green on unchanged code.
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost } from '../../../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'

type Row = Record<string, unknown>
const em = { findOne: jest.fn(), find: jest.fn(), flush: jest.fn() }

jest.mock('../../../context', () => ({
  resolveCpqRouteContext: jest.fn(async () => ({
    auth: { sub: 'user-1', tenantId: 't-1' }, organizationId: 'org-1', tenantId: 't-1', em,
  })),
}))
jest.mock('../../../resolveQuotingService', () => ({ resolveQuotingService: () => ({}) }))

import { DELETE } from '../route'

const params = { params: Promise.resolve({ quoteId: 'cpq-1' }) }
const del = () => DELETE(new Request('http://localhost/api/cpq/quotes/cpq-1', { method: 'DELETE' }), params)

function setup(cpqStatus: string) {
  const config: Row = { id: 'cpq-1', quoteId: 'sales-1', cpqStatus, deletedAt: null }
  const lines: Row[] = [{ id: 'lc-1', quoteLineId: 'sl-1', deletedAt: null }, { id: 'lc-2', quoteLineId: 'sl-2', deletedAt: null }]
  const salesLines: Row[] = [{ id: 'sl-1', deletedAt: null }, { id: 'sl-2', deletedAt: null }]
  const salesQuote: Row = { id: 'sales-1', deletedAt: null }
  const costs: Row[] = [{ id: 'cost-1', quoteConfigurationId: 'cpq-1', sourcingStatus: 'not_requested', costRequestId: null, deletedAt: null }]
  em.findOne.mockReset(); em.find.mockReset(); em.flush.mockReset().mockResolvedValue(undefined)
  em.findOne.mockImplementation(async (entity: unknown, where: Row) => {
    if (entity === CpqQuoteConfiguration) return where.id === 'cpq-1' || where.quoteId === 'cpq-1' ? config : null
    if (entity === SalesQuoteLine) return salesLines.find((row) => row.id === where.id) ?? null
    if (entity === SalesQuote) return where.id === 'sales-1' ? salesQuote : null
    return null
  })
  em.find.mockImplementation(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? lines : []))
  return { config, lines, salesLines, salesQuote, costs }
}

describe('DELETE /api/cpq/quotes/{quoteId} (characterization)', () => {
  it.each(['accepted', 'rejected', 'cancelled'])('answers 409 for a quote in %s status and writes nothing', async (status) => {
    const { config, lines, salesQuote } = setup(status)
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain(status)
    expect(config.deletedAt).toBeNull()
    expect(salesQuote.deletedAt).toBeNull()
    expect(lines.every((row) => row.deletedAt === null)).toBe(true)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each(['new', 'ready', 'with_customer'])('soft-deletes config, lines, sales quote and sales lines in %s status and answers { ok: true }', async (status) => {
    const { config, lines, salesLines, salesQuote } = setup(status)
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    for (const row of [config, salesQuote, ...lines, ...salesLines]) expect(row.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('does not touch cost lines or their sourcing columns today (feature 3 step 9 changes this)', async () => {
    const { costs } = setup('ready')
    await del()
    expect(em.find).not.toHaveBeenCalledWith(CpqQuoteLineCost, expect.anything(), expect.anything())
    expect(em.find.mock.calls.every(([entity]) => entity !== CpqQuoteLineCost)).toBe(true)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'not_requested', costRequestId: null, deletedAt: null })
  })

  it('answers 404 for an unknown quote and does not flush', async () => {
    setup('ready')
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), { params: Promise.resolve({ quoteId: 'nope' }) })
    expect(res.status).toBe(404)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('looks the quote up by configuration id first, then by sales quote id, scoped and not deleted', async () => {
    setup('ready')
    await del()
    expect(em.findOne).toHaveBeenCalledWith(CpqQuoteConfiguration, { id: 'cpq-1', organizationId: 'org-1', tenantId: 't-1', deletedAt: null })
  })
})
