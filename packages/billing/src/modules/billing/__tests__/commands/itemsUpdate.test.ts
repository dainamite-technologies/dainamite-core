jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return { ...actual, emitCrudSideEffects: jest.fn(async () => undefined) }
})

import { createItemCommand, updateItemCommand } from '../../commands/items'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const ACCOUNT = '44444444-4444-4444-8444-444444444444'

function env(record: Record<string, unknown> | null) {
  const em = {
    findOne: jest.fn(async () => record),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'new', ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    fork: jest.fn((): unknown => em),
  }
  const ctx = {
    container: { resolve: jest.fn((name: string) => (name === 'dataEngine' ? {} : em)) },
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    organizationScope: null,
  }
  return { ctx }
}

const billedItem = (): Record<string, unknown> => ({
  id: ITEM,
  tenantId: TENANT,
  organizationId: ORG,
  type: 'recurring',
  isActive: true,
  deletedAt: null,
  billStartDate: '2026-11-01',
  billEndDate: null,
  billedToDate: '2026-12-31',
  prorate: true,
  rateJson: { unit_price: 49 },
  priceBasis: 'net',
})

const scope = { tenantId: TENANT, organizationId: ORG, id: ITEM }

describe('updateItemCommand — Part 2 guards', () => {
  it('rejects an end date more than one day before the start', async () => {
    const { ctx } = env({ ...billedItem(), billedToDate: null })
    await expect(
      updateItemCommand.execute({ ...scope, billEndDate: new Date('2026-10-20T00:00:00Z') }, ctx as never),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.end_before_start' } })
  })

  it('requires a reason when an earlier end date credits billed days', async () => {
    const { ctx } = env(billedItem())
    await expect(
      updateItemCommand.execute({ ...scope, billEndDate: new Date('2026-12-15T00:00:00Z') }, ctx as never),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.credit_reason_required' } })
  })

  it('stores a generated reason with its params', async () => {
    const record = billedItem()
    const { ctx } = env(record)
    await updateItemCommand.execute(
      {
        ...scope,
        billEndDate: new Date('2026-12-15T00:00:00Z'),
        creditReasonCode: 'subscription_amended',
        creditReasonParams: { reference: 'SO-1', effectiveDate: '2026-12-16' },
      },
      ctx as never,
    )
    expect(record.creditReason).toEqual({
      kind: 'code',
      code: 'subscription_amended',
      params: { reference: 'SO-1', effectiveDate: '2026-12-16' },
    })
  })

  it('ignores a reason when nothing is credited and leaves other edits alone', async () => {
    const record = billedItem()
    const { ctx } = env(record)
    await updateItemCommand.execute({ ...scope, description: 'Renamed', creditReason: 'unused' }, ctx as never)
    expect(record.description).toBe('Renamed')
    expect(record.creditReason).toBeUndefined()
  })
})

describe('createItemCommand — end before start', () => {
  it('rejects an item that ends more than a day before it starts', async () => {
    const { ctx } = env({ id: ACCOUNT, tenantId: TENANT, organizationId: ORG, currencyCode: 'EUR', deletedAt: null })
    await expect(
      createItemCommand.execute(
        {
          tenantId: TENANT,
          organizationId: ORG,
          billAccountId: ACCOUNT,
          type: 'recurring',
          billStartDate: new Date('2026-11-20T00:00:00Z'),
          billEndDate: new Date('2026-11-14T00:00:00Z'),
          description: 'Plan',
          rateJson: { unit_price: 10 },
          taxRate: 23,
        },
        ctx as never,
      ),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.end_before_start' } })
  })
})
