/**
 * D6 — `cpq.change_subscription_status`: approval guard, preview card, the
 * built request (parity with the route validator) and route features.
 */
import { createAiApiOperationRunner } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { cpqSubscriptionStatusActionSchema } from '../../data/validators'
import { CPQ_WRITE_TOOLS } from '../../ai-agents'
import { FakeApi, SUBSCRIPTION_ID, getTool, makeCtx } from './harness'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => {
  const actual = jest.requireActual('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner')
  return { ...actual, createAiApiOperationRunner: jest.fn() }
})

const mockedCreateRunner = jest.mocked(createAiApiOperationRunner)
const ITEM_ID = '77777777-7777-4777-8777-777777777777'
const approvedCtx = () => makeCtx({ approvedPendingActionId: 'pending-action-1' })

let api: FakeApi
beforeEach(() => {
  api = new FakeApi()
  mockedCreateRunner.mockReset()
  mockedCreateRunner.mockImplementation(() => ({ run: api.run }) as unknown as ReturnType<typeof createAiApiOperationRunner>)
  api.on('GET', '/cpq/inventory/subscriptions', {
    id: SUBSCRIPTION_ID,
    code: 'SUB-1',
    name: 'Internet + Mobile',
    status: 'active',
    items: [{ id: 'root', name: 'Internet', status: 'active', children: [{ id: ITEM_ID, name: 'Mobile', status: 'active', children: [] }] }],
  })
})

describe('cpq.change_subscription_status', () => {
  const tool = () => getTool('cpq.change_subscription_status')

  it('is a destructive mutation allowlisted on the quoting assistant', () => {
    expect(tool().isMutation).toBe(true)
    expect(tool().isDestructive).toBe(true)
    expect(CPQ_WRITE_TOOLS).toContain('cpq.change_subscription_status')
  })

  it('refuses without an approved pending action', async () => {
    const input = tool().inputSchema.parse({ subscriptionId: SUBSCRIPTION_ID, action: 'suspend' })
    await expect(tool().handler(input, makeCtx())).rejects.toMatchObject({ code: 'mutation_not_approved' })
    expect(api.writes()).toHaveLength(0)
  })

  it('posts an item-level pause the route validator accepts', async () => {
    api.on('POST', '/cpq/inventory/subscriptions/actions', { subscription: { id: SUBSCRIPTION_ID }, subscriptionItemIds: [ITEM_ID] })
    const input = tool().inputSchema.parse({
      subscriptionId: SUBSCRIPTION_ID,
      subscriptionItemId: ITEM_ID,
      action: 'pause',
      fromDate: '2027-01-10',
      toDate: '2027-01-19',
      reason: 'Customer travelling',
    })
    await expect(tool().handler(input, approvedCtx())).resolves.toEqual({ subscription: { id: SUBSCRIPTION_ID }, subscriptionItemIds: [ITEM_ID] })
    const [write] = api.writes()
    expect(write).toMatchObject({ method: 'POST', path: '/cpq/inventory/subscriptions/actions' })
    expect(write.body).toEqual({
      subscriptionId: SUBSCRIPTION_ID,
      subscriptionItemId: ITEM_ID,
      action: 'pause',
      fromDate: '2027-01-10',
      toDate: '2027-01-19',
      reason: 'Customer travelling',
    })
    expect(() => cpqSubscriptionStatusActionSchema.parse(write.body)).not.toThrow()
  })

  it('previews the item (found in the item tree) with its current and next status', async () => {
    const preview = await tool().loadBeforeRecord!(
      { subscriptionId: SUBSCRIPTION_ID, subscriptionItemId: ITEM_ID, action: 'suspend', chargeBehavior: 'no_charge' },
      makeCtx(),
    )
    expect(preview).toMatchObject({
      recordId: SUBSCRIPTION_ID,
      before: { target: 'Mobile', status: 'active' },
      after: { target: 'Mobile', status: 'suspended', chargeBehavior: 'no_charge', fromDate: 'today' },
    })
  })

  it('rejects unknown fields (strict input)', () => {
    expect(() => tool().inputSchema.parse({ subscriptionId: SUBSCRIPTION_ID, action: 'pause', status: 'paused' })).toThrow()
  })
})
