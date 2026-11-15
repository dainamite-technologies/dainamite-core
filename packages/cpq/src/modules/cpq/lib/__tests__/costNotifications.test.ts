const getRecipientUserIdsForFeature = jest.fn()
const getScopedNotificationRecipientUserIds = jest.fn()
jest.mock('@open-mercato/core/modules/notifications/lib/notificationRecipients', () => ({
  getRecipientUserIdsForFeature: (...args: unknown[]) => getRecipientUserIdsForFeature(...args),
  getScopedNotificationRecipientUserIds: (...args: unknown[]) => getScopedNotificationRecipientUserIds(...args),
}))
import { answeredBodyKey, notifyCostManagers, resolveCostManagerUserIds } from '../costNotifications'
import { notificationTypes } from '../../notifications'

const db = { marker: 'kysely' }
const em = { getKysely: jest.fn(() => db) }
const scope = { tenantId: 'tenant' }
const typeDef = notificationTypes.find((type) => type.type === 'cpq.cost_request.opened')!
const content = { typeDef, bodyVariables: { quoteNumber: 'Q-1', costName: 'Tail', productName: 'Link' }, linkHref: '/backend/cpq/cost-requests?quoteId=q1' }

function setup(features: Record<string, string[]>, opts: { inOrg?: string[] } = {}) {
  getRecipientUserIdsForFeature.mockResolvedValue(Object.keys(features))
  getScopedNotificationRecipientUserIds.mockImplementation(async (_db: unknown, _t: string, _o: string, ids: string[]) => ids.filter((id) => (opts.inOrg ?? Object.keys(features)).includes(id)))
  const rbacService = { userHasAllFeatures: jest.fn(async (user: string, required: string[]) => required.every((feature) => features[user]?.includes(feature))) }
  const notificationService = { createBatch: jest.fn(async () => []) }
  return { rbacService, notificationService, deps: { em: em as never, rbacService: rbacService as never, notificationService: notificationService as never } }
}

beforeEach(() => jest.clearAllMocks())

describe('notifyCostManagers (Q16)', () => {
  it('looks up cpq.costs.manage candidates in the tenant, keeps those with view AND manage in the organization, and sends one batch', async () => {
    const { deps, rbacService, notificationService } = setup({ both: ['cpq.costs.view', 'cpq.costs.manage'], manageOnly: ['cpq.costs.manage'] })
    expect(await notifyCostManagers(scope, 'org', content, deps)).toBe(1)
    expect(getRecipientUserIdsForFeature).toHaveBeenCalledWith(db, 'tenant', 'cpq.costs.manage')
    expect(rbacService.userHasAllFeatures).toHaveBeenCalledWith('both', ['cpq.costs.view', 'cpq.costs.manage'], { tenantId: 'tenant', organizationId: 'org' })
    expect(notificationService.createBatch).toHaveBeenCalledTimes(1)
    const [input, ctx] = notificationService.createBatch.mock.calls[0] as unknown as [Record<string, unknown>, unknown]
    expect(input).toMatchObject({ type: 'cpq.cost_request.opened', recipientUserIds: ['both'], linkHref: content.linkHref, bodyVariables: content.bodyVariables })
    expect(ctx).toEqual({ tenantId: 'tenant', organizationId: 'org' })
  })

  it('excludes a user with cpq.costs.manage but not cpq.costs.view', async () => {
    const { deps, notificationService } = setup({ manageOnly: ['cpq.costs.manage'] })
    expect(await notifyCostManagers(scope, 'org', content, deps)).toBe(0)
    expect(notificationService.createBatch).not.toHaveBeenCalled()
  })

  it('excludes a user of another organization', async () => {
    const { deps, notificationService } = setup({ local: ['cpq.costs.view', 'cpq.costs.manage'], foreign: ['cpq.costs.view', 'cpq.costs.manage'] }, { inOrg: ['local'] })
    expect(await resolveCostManagerUserIds(scope, 'org', deps)).toEqual(['local'])
    await notifyCostManagers(scope, 'org', content, deps)
    expect((notificationService.createBatch.mock.calls[0] as unknown as [{ recipientUserIds: string[] }])[0].recipientUserIds).toEqual(['local'])
    expect(getScopedNotificationRecipientUserIds).toHaveBeenCalledWith(db, 'tenant', 'org', ['local', 'foreign'])
  })

  it('does not call the notification service without candidates', async () => {
    const { deps, notificationService } = setup({})
    expect(await notifyCostManagers(scope, 'org', content, deps)).toBe(0)
    expect(notificationService.createBatch).not.toHaveBeenCalled()
  })

  it('carries data and a body key override into the batch, without amounts', async () => {
    const { deps, notificationService } = setup({ both: ['cpq.costs.view', 'cpq.costs.manage'] })
    await notifyCostManagers(scope, 'org', { ...content, bodyKey: 'x.body', data: { quoteId: 'q1' } }, deps)
    expect(notificationService.createBatch.mock.calls[0][0]).toMatchObject({ bodyKey: 'x.body', data: { quoteId: 'q1' } })
  })
})

describe('answeredBodyKey', () => {
  const p = 'cpq.notifications.costRequest.answered.body'
  it.each([
    [{ valueStatus: 'confirmed', lineReady: true }, 'confirmed'],
    [{ valueStatus: 'estimated', lineReady: true }, 'estimated'],
    [{ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', lineReady: false }, 'rateMissing'],
    [{ valueStatus: 'confirmed', lineReady: false }, 'notReady'],
    [{ valueStatus: 'confirmed', errorCode: 'CURRENCY_NO_RATE', lineReady: true }, 'rateMissing'],
  ])('%j -> %s', (event, variant) => expect(answeredBodyKey(event)).toBe(`${p}.${variant}`))
})
