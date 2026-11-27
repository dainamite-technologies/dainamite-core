import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CpqQuotePriceAdjustment } from '../../data/entities'
import { loadOrderPriceAdjustments, withAuthors } from '../priceAdjustments/adjustmentReadModel'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const ann = '33333333-3333-4333-8333-333333333333', bob = '44444444-4444-4444-8444-444444444444', gone = '55555555-5555-4555-8555-555555555555'
const quoteConfigurationId = '66666666-6666-4666-8666-666666666666', lineId = '77777777-7777-4777-8777-777777777777'

function makeEm(rows: Array<Record<string, unknown>> = []) {
  const users = [{ id: ann, name: ' Ann Rep ', email: 'ann@example.com' }, { id: bob, name: null, email: 'bob@example.com' }]
  const find = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === User) return users.filter((user) => (where.id as { $in: string[] }).$in.includes(user.id))
    if (entity === CpqQuotePriceAdjustment) return rows
    if (entity === DictionaryEntry) return [{ value: 'promotion', label: 'Promotion' }]
    return []
  })
  const findOne = jest.fn(async (entity: unknown) => (entity === Dictionary ? { id: 'dictionary' } : null))
  return { find, findOne }
}

it('resolves author names in one tenant-scoped batch, falling back to null', async () => {
  const em = makeEm()
  const rows = [{ id: 'a', createdByUserId: ann }, { id: 'b', createdByUserId: bob }, { id: 'c', createdByUserId: ann }, { id: 'd', createdByUserId: gone }]
  const out = await withAuthors(em as never, rows, scope)
  expect(out.map((row) => [row.id, row.createdByName, row.createdByEmail])).toEqual([
    ['a', 'Ann Rep', 'ann@example.com'], ['b', null, 'bob@example.com'], ['c', 'Ann Rep', 'ann@example.com'], ['d', null, null],
  ])
  const userCalls = em.find.mock.calls.filter(([entity]) => entity === User)
  expect(userCalls).toHaveLength(1)
  expect(userCalls[0][1]).toEqual({ id: { $in: [ann, bob, gone] }, tenantId: scope.tenantId })
})

it('skips the user lookup when there are no rows', async () => {
  const em = makeEm()
  expect(await withAuthors(em as never, [], scope)).toEqual([])
  expect(em.find).not.toHaveBeenCalled()
})

it('loads the source quote\'s active adjustments for an order with author and reason label', async () => {
  const now = new Date('2026-11-27T10:00:00.000Z')
  const row = { id: '88888888-8888-4888-8888-888888888888', level: 'line', quoteLineId: lineId, chargeCode: null, chargeTypeFilter: 'mrc', adjustmentType: 'discount_percent',
    value: '50', currencyCode: null, reasonCode: 'promotion', reasonNote: null, windowKind: 'relative', fromMonth: 2, toMonth: 4, phaseName: '50% off',
    quoteConfigurationId, quoteId: quoteConfigurationId, ...scope, createdByUserId: ann, createdAt: now, updatedAt: now, deletedAt: null, isActive: true }
  const em = makeEm([row])
  const [item] = await loadOrderPriceAdjustments(em as never, quoteConfigurationId, scope)
  expect(item).toMatchObject({ id: row.id, value: 50, fromMonth: 2, toMonth: 4, phaseName: '50% off', reasonLabel: 'Promotion', createdByName: 'Ann Rep' })
  expect(em.find.mock.calls[0][1]).toEqual({ quoteConfigurationId, ...scope, deletedAt: null, isActive: true })
  expect(await loadOrderPriceAdjustments(em as never, null, scope)).toEqual([])
})
