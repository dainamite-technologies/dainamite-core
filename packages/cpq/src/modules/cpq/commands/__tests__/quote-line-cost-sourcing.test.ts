import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  answerQuoteLineCostCommand, cancelRequestQuoteLineCostCommand, declineQuoteLineCostCommand, requestQuoteLineCostCommand,
} from '../quote-line-cost-sourcing'

const quoteId = '11111111-1111-4111-8111-111111111111', costId = '22222222-2222-4222-8222-222222222222', requestId = '55555555-5555-4555-8555-555555555555'
const actor = '33333333-3333-4333-8333-333333333333', tenantId = '44444444-4444-4444-8444-444444444444', organizationId = '66666666-6666-4666-8666-666666666666'

function setup() {
  const service = { request: jest.fn(), cancelRequest: jest.fn(), answer: jest.fn(), decline: jest.fn() }
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const ctx = { auth: { sub: actor, tenantId }, selectedOrganizationId: organizationId,
    container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : service } } as unknown as CommandRuntimeContext
  return { ctx, service, userHasAllFeatures }
}

it('uses the authenticated actor and scope and requires cpq.quotes.manage only (reps open requests)', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  await requestQuoteLineCostCommand.execute({ quoteId, costId, request: { supplierName: 'X' } }, ctx)
  expect(service.request).toHaveBeenCalledWith(quoteId, costId, { supplierName: 'X' }, actor, { tenantId, organizationId })
  await cancelRequestQuoteLineCostCommand.execute({ quoteId, costId, cancel: { costRequestId: requestId } }, ctx)
  expect(service.cancelRequest).toHaveBeenCalledWith(quoteId, costId, { costRequestId: requestId }, actor, { tenantId, organizationId })
  expect(userHasAllFeatures).toHaveBeenCalledWith(actor, ['cpq.quotes.manage'], { tenantId, organizationId })
})

it('refuses missing permissions, a missing organization and a non-user API key before any service write', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  userHasAllFeatures.mockResolvedValue(false)
  await expect(requestQuoteLineCostCommand.execute({ quoteId, costId, request: {} }, ctx)).rejects.toMatchObject({ status: 403 })
  userHasAllFeatures.mockResolvedValue(true)
  await expect(requestQuoteLineCostCommand.execute({ quoteId, costId, request: {} }, { ...ctx, selectedOrganizationId: null })).rejects.toMatchObject({ status: 403 })
  const orphan = { ...ctx, auth: { sub: 'api_key:k', tenantId } } as unknown as CommandRuntimeContext
  await expect(cancelRequestQuoteLineCostCommand.execute({ quoteId, costId, cancel: { costRequestId: requestId } }, orphan)).rejects.toMatchObject({ status: 403 })
  expect(service.request).not.toHaveBeenCalled()
  expect(service.cancelRequest).not.toHaveBeenCalled()
})

it('is not undoable and its log carries ids, statuses, the sequence and the reason only', async () => {
  for (const command of [requestQuoteLineCostCommand, cancelRequestQuoteLineCostCommand]) {
    expect(command.isUndoable).toBe(false)
    expect(command.undo).toBeUndefined()
  }
  const result = {
    response: { costId, sourcingStatus: 'cancelled', costRequestId: requestId, requestSeq: 2, pricingRevision: 5 },
    audit: {
      before: { id: costId, quoteLineId: 'l1', costKey: 'tail', sourcingStatus: 'requested', costRequestId: requestId, requestSeq: 2 },
      after: { id: costId, quoteLineId: 'l1', costKey: 'tail', sourcingStatus: 'cancelled', costRequestId: requestId, requestSeq: 2, reason: 'cancelled_by_user' },
    },
    signals: [],
  }
  const input = { quoteId, costId, cancel: { costRequestId: requestId, note: 'secret note 7777.77' } }
  const log = await cancelRequestQuoteLineCostCommand.buildLog!({ input, result, ctx: setup().ctx, snapshots: {} } as never)
  expect(log).toMatchObject({ resourceKind: 'cpq.quote_line_cost', resourceId: costId, replayable: false, snapshotAfter: { sourcingStatus: 'cancelled', reason: 'cancelled_by_user' } })
  const json = JSON.stringify(log)
  for (const leak of ['secret note', '7777']) expect(json).not.toContain(leak)
})

it('rejects invalid input shapes before reaching the service', async () => {
  const { ctx, service } = setup()
  await expect(requestQuoteLineCostCommand.execute({ quoteId, costId, request: { unitAmount: 1 } } as never, ctx)).rejects.toThrow()
  await expect(cancelRequestQuoteLineCostCommand.execute({ quoteId, costId, cancel: {} } as never, ctx)).rejects.toThrow()
  await expect(requestQuoteLineCostCommand.execute({ quoteId: 'bad', costId, request: {} } as never, ctx)).rejects.toThrow()
  expect(service.request).not.toHaveBeenCalled()
})

describe('answer / decline commands (step 7)', () => {
  const answer = { costRequestId: requestId, unitAmount: 280, currencyCode: 'EUR', supplierQuoteRef: 'CARR-889' }

  it('answer and decline need cpq.costs.view + cpq.costs.manage (Q13)', async () => {
    const { ctx, service, userHasAllFeatures } = setup()
    await answerQuoteLineCostCommand.execute({ quoteId, costId, answer }, ctx)
    expect(userHasAllFeatures).toHaveBeenLastCalledWith(actor, ['cpq.costs.view', 'cpq.costs.manage'], { tenantId, organizationId })
    await declineQuoteLineCostCommand.execute({ quoteId, costId, decline: { costRequestId: requestId, reason: 'No coverage' } }, ctx)
    expect(userHasAllFeatures).toHaveBeenLastCalledWith(actor, ['cpq.costs.view', 'cpq.costs.manage'], { tenantId, organizationId })
    expect(service.answer).toHaveBeenCalledWith(quoteId, costId, expect.objectContaining({ supplierQuoteRef: 'CARR-889', valueStatus: 'confirmed' }), actor, { tenantId, organizationId })
    expect(service.decline).toHaveBeenCalledWith(quoteId, costId, { costRequestId: requestId, reason: 'No coverage' }, actor, { tenantId, organizationId })
  })

  it('refuses missing permissions before any service write and rejects invalid shapes (no expectedRevision on answer)', async () => {
    const { ctx, service, userHasAllFeatures } = setup()
    userHasAllFeatures.mockResolvedValue(false)
    await expect(answerQuoteLineCostCommand.execute({ quoteId, costId, answer }, ctx)).rejects.toMatchObject({ status: 403 })
    userHasAllFeatures.mockResolvedValue(true)
    await expect(answerQuoteLineCostCommand.execute({ quoteId, costId, answer: { ...answer, expectedRevision: 1 } } as never, ctx)).rejects.toThrow()
    await expect(answerQuoteLineCostCommand.execute({ quoteId, costId, answer: { ...answer, supplierQuoteRef: '' } } as never, ctx)).rejects.toThrow()
    await expect(answerQuoteLineCostCommand.execute({ quoteId, costId, answer: { ...answer, unitAmount: -1 } } as never, ctx)).rejects.toThrow()
    await expect(declineQuoteLineCostCommand.execute({ quoteId, costId, decline: { costRequestId: requestId, reason: '' } } as never, ctx)).rejects.toThrow()
    expect(service.answer).not.toHaveBeenCalled()
    expect(service.decline).not.toHaveBeenCalled()
  })

  it('are not undoable and their logs never carry an amount, supplier or note', async () => {
    const result = {
      response: {}, signals: [],
      audit: { before: { id: costId, sourcingStatus: 'requested' }, after: { id: costId, sourcingStatus: 'answered', reason: 'proposed' } },
    }
    for (const command of [answerQuoteLineCostCommand, declineQuoteLineCostCommand]) {
      expect(command.isUndoable).toBe(false)
      const log = await command.buildLog!({ input: { answer: { unitAmount: 7777.77, note: 'secret note' } }, result, ctx: setup().ctx, snapshots: {} } as never)
      expect(log).toMatchObject({ replayable: false, resourceId: costId })
      expect(JSON.stringify(log)).not.toMatch(/7777|secret/)
    }
  })
})
