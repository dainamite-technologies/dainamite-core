/**
 * `GET /api/cpq/quotes?search=` matches the quote number or an exact id.
 *
 * Before the fix the route ran `$ilike` on the uuid columns `quote_id` and
 * `customer_id`, which Postgres rejects ("operator does not exist: uuid ~~*
 * unknown"), so every search answered 500. Found through the AI agent, which
 * searches quotes by number.
 */
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { CpqQuoteConfiguration } from '../../../data/entities'

const find = jest.fn()
const findAndCount = jest.fn()

jest.mock('../../context', () => ({
  cpqContextError: jest.requireActual('../../context').cpqContextError,
  resolveCpqRouteContext: async () => ({
    auth: { sub: 'user' },
    tenantId: 'tenant',
    organizationId: 'org',
    em: { find, findAndCount },
  }),
}))

import { GET } from '../route'

const quoteId = '22222222-2222-4222-8222-222222222222'

function list(search: string) {
  return GET(new Request(`http://localhost/api/cpq/quotes?search=${encodeURIComponent(search)}`))
}

function cpqFilter(): Record<string, unknown> {
  expect(findAndCount).toHaveBeenCalledTimes(1)
  expect(findAndCount.mock.calls[0][0]).toBe(CpqQuoteConfiguration)
  return findAndCount.mock.calls[0][1]
}

beforeEach(() => {
  find.mockReset()
  findAndCount.mockReset()
  findAndCount.mockResolvedValue([[], 0])
})

it('matches the quote number on the sales quote, never with ilike on uuid columns', async () => {
  find.mockImplementation(async (entity: unknown) => (entity === SalesQuote ? [{ id: quoteId }] : []))

  const res = await list('20261123-00003')

  expect(res.status).toBe(200)
  const [entity, where, options] = find.mock.calls[0]
  expect(entity).toBe(SalesQuote)
  expect(where).toEqual({
    organizationId: 'org',
    tenantId: 'tenant',
    deletedAt: null,
    quoteNumber: { $ilike: '%20261123-00003%' },
  })
  expect(options).toEqual(expect.objectContaining({ fields: ['id'], limit: 1000 }))
  const filter = cpqFilter()
  expect(filter.$or).toEqual([{ quoteId: { $in: [quoteId] } }])
  expect(JSON.stringify(filter)).not.toContain('$ilike')
})

it('escapes LIKE wildcards in the search text', async () => {
  find.mockResolvedValue([])
  await list('100%_x')
  expect(find.mock.calls[0][1].quoteNumber).toEqual({ $ilike: '%100\\%\\_x%' })
})

it('matches a UUID exactly against the quote, sales quote and customer ids', async () => {
  find.mockResolvedValue([])

  const res = await list(quoteId)

  expect(res.status).toBe(200)
  expect(cpqFilter().$or).toEqual([{ id: quoteId }, { quoteId }, { customerId: quoteId }])
})

it('returns an empty page without querying quotes when nothing matches', async () => {
  find.mockResolvedValue([])

  const res = await list('no-such-quote')

  expect(res.status).toBe(200)
  await expect(res.json()).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })
  expect(findAndCount).not.toHaveBeenCalled()
})
