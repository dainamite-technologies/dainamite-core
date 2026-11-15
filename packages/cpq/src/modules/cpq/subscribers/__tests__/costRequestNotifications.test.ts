const createBatch = jest.fn(async (..._args: unknown[]) => [])
const notifyCostManagers = jest.fn(async (..._args: unknown[]) => 1)
jest.mock('../../lib/costNotifications', () => ({ ...jest.requireActual('../../lib/costNotifications'), notifyCostManagers: (...args: unknown[]) => notifyCostManagers(...args) }))
import handler, { metadata, costValuedNotificationType } from '../cost-request-notifications'
import openedHandler, { metadata as openedMetadata } from '../cost-request-opened-notification'
import { notificationTypes } from '../../notifications'

const em = { fork: () => em, findOne: jest.fn(async (_entity: unknown, where: { id: string }) => (where.id === 'sales-1' ? { quoteNumber: 'Q-123' } : { name: 'Link 10G' })) }
const ctx = { resolve: jest.fn((name: string) => {
  if (name === 'em') return em
  if (name === 'notificationService') return { createBatch }
  return { userHasAllFeatures: jest.fn() }
}) } as never
const ctxWithoutNotifications = { resolve: (name: string) => { if (name === 'em') return em; throw new Error(`not registered: ${name}`) } } as never
const base = {
  tenantId: 't', organizationId: 'o', quoteId: 'cpq-1', salesQuoteId: 'sales-1', quoteLineId: 'line-1', costLineId: 'cost-1', costRequestId: 'req-1',
  costName: 'Tail', cause: 'answer', answerPending: false, valueStatus: 'confirmed', errorCode: null, lineReady: true, requestedByUserId: 'u1',
}
const sent = () => createBatch.mock.calls[0] as unknown as [Record<string, any>, Record<string, string>]

beforeEach(() => jest.clearAllMocks())

describe('cost_valued requester notifications', () => {
  it('is a persistent subscriber of cost_valued', () => {
    expect(metadata).toEqual({ event: 'cpq.quote.cost_valued', persistent: true, id: 'cpq-cost-request-notifications' })
  })

  it.each([
    [{ valueStatus: 'confirmed' }, 'confirmed'],
    [{ valueStatus: 'estimated' }, 'estimated'],
    [{ valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', lineReady: false }, 'rateMissing'],
    [{ lineReady: false }, 'notReady'],
  ] as Array<[Record<string, any>, string]>)('answered %j picks the %s body', async (over, variant) => {
    await handler({ ...base, ...over }, ctx)
    const [input, scope] = sent()
    expect(input).toMatchObject({ type: 'cpq.cost_request.answered', recipientUserIds: ['u1'], bodyKey: `cpq.notifications.costRequest.answered.body.${variant}`, linkHref: '/backend/cpq/quotes/cpq-1' })
    expect(input.bodyVariables).toEqual({ quoteNumber: 'Q-123', costName: 'Tail', productName: 'Link 10G' })
    expect(input.data).toMatchObject({ valueStatus: over.valueStatus ?? 'confirmed', lineReady: String(over.lineReady ?? true), cause: 'answer' })
    expect(scope).toEqual({ tenantId: 't', organizationId: 'o' })
  })

  it('answer_pending when a different-value answer waits (and not answered)', async () => {
    await handler({ ...base, answerPending: true }, ctx)
    expect(sent()[0]).toMatchObject({ type: 'cpq.cost_request.answer_pending', bodyKey: 'cpq.notifications.costRequest.answerPending.body' })
    expect(createBatch).toHaveBeenCalledTimes(1)
  })

  it('declined on a decline', async () => {
    await handler({ ...base, cause: 'decline', valueStatus: 'none' }, ctx)
    expect(sent()[0]).toMatchObject({ type: 'cpq.cost_request.declined', recipientUserIds: ['u1'] })
  })

  it('sends nothing for other causes, a missing requester or an incomplete payload', async () => {
    for (const payload of [{ ...base, cause: 'manual_value' }, { ...base, cause: 'apply_answer' }, { ...base, cause: 'reset' }, { ...base, requestedByUserId: null }, { ...base, tenantId: null }]) {
      await handler(payload as never, ctx)
    }
    expect(createBatch).not.toHaveBeenCalled()
    expect(costValuedNotificationType({ cause: 'reset' })).toBeNull()
  })

  it('never carries an amount in title, body or data', async () => {
    await handler({ ...base, unitAmount: '7777.77', amount: 7777.77 } as never, ctx)
    expect(JSON.stringify(createBatch.mock.calls)).not.toMatch(/7777|unitAmount|amount/i)
  })

  it('logs and rethrows a failure so the queue retries', async () => {
    createBatch.mockRejectedValueOnce(new Error('boom'))
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(handler(base, ctx)).rejects.toThrow('boom')
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('cpq-1'), expect.any(Error))
    errors.mockRestore()
  })
})

describe('optional notifications module', () => {
  it('no-ops when notificationService is not registered', async () => {
    await handler(base, ctxWithoutNotifications)
    await openedHandler(base, ctxWithoutNotifications)
    expect(createBatch).not.toHaveBeenCalled()
    expect(notifyCostManagers).not.toHaveBeenCalled()
  })
})

describe('cost_requested manager notification', () => {
  it('is persistent and notifies the cost managers of the quote organization', async () => {
    expect(openedMetadata).toEqual({ event: 'cpq.quote.cost_requested', persistent: true, id: 'cpq-cost-request-opened-notification' })
    await openedHandler({ ...base, costKey: 'tail' }, ctx)
    const [scope, organizationId, content] = notifyCostManagers.mock.calls[0] as unknown as [Record<string, string>, string, Record<string, any>]
    expect(scope).toEqual({ tenantId: 't', organizationId: 'o' })
    expect(organizationId).toBe('o')
    expect(content).toMatchObject({ linkHref: '/backend/cpq/cost-requests?quoteId=cpq-1', bodyVariables: { quoteNumber: 'Q-123', costName: 'Tail', productName: 'Link 10G' } })
    expect(content.typeDef.type).toBe('cpq.cost_request.opened')
    expect(JSON.stringify(content.data)).not.toMatch(/amount/i)
  })

  it('ignores an incomplete payload', async () => {
    await openedHandler({ tenantId: 't' } as never, ctx)
    expect(notifyCostManagers).not.toHaveBeenCalled()
  })
})

describe('notification types', () => {
  it('declares the four frozen ids, in-app + email, with i18n keys that exist in en.json and no push', () => {
    const en = require('../../i18n/en.json') as Record<string, string>
    expect(notificationTypes.map((type) => type.type)).toEqual(['cpq.cost_request.opened', 'cpq.cost_request.answered', 'cpq.cost_request.answer_pending', 'cpq.cost_request.declined'])
    for (const type of notificationTypes) {
      expect(type.channels).toEqual(['in_app', 'email'])
      expect(en[type.titleKey]).toBeTruthy()
      expect(en[type.bodyKey as string]).toBeTruthy()
    }
    for (const variant of ['confirmed', 'estimated', 'rateMissing', 'notReady']) expect(en[`cpq.notifications.costRequest.answered.body.${variant}`]).toBeTruthy()
    expect(en['notifications.categories.cpq']).toBeTruthy()
    expect(Object.values(en).join(' ')).not.toMatch(/\{(unitAmount|amount|price)\}/)
  })
})
