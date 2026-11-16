import { ACTIVATION_BEFORE_BILLING_START_CODE, createActivationGuard, guards } from '../../data/guards'
import type { MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const ORDER = '22222222-2222-4222-8222-222222222222'

function input(overrides: Partial<MutationGuardInput> = {}): MutationGuardInput {
  return {
    tenantId: 't-1',
    organizationId: 'o-1',
    userId: 'u-1',
    resourceKind: 'cpq.order',
    resourceId: ORDER,
    operation: 'update',
    requestMethod: 'POST',
    requestHeaders: new Headers(),
    mutationPayload: { action: 'activate', orderId: ORDER },
    ...overrides,
  }
}

function guardWith(resolve: jest.Mock, today = '2026-11-16') {
  const container = { resolve: jest.fn(() => ({ resolveEarliestActivationForOrder: resolve })) }
  return { guard: createActivationGuard({
      container: async () => container,
      today: () => today,
      // Fallback text with filled params — the shape a real translator returns.
      translate: async () => (_key: string, fallback: string, params?: Record<string, string>) =>
        fallback.replace(/\{(\w+)\}/g, (m, k: string) => params?.[k] ?? m),
    }), container }
}

const earliest = { date: '2026-11-20', subscriptionId: 'sub-1', itemDescription: 'Fiber 300' }

describe('cpq_billing_connector activation guard', () => {
  it('is exported on cpq.order updates', () => {
    expect(guards).toHaveLength(1)
    expect(guards[0]).toMatchObject({ targetEntity: 'cpq.order', operations: ['update'] })
  })

  it('blocks activation before the earliest date with 422, the code and the date', async () => {
    const resolve = jest.fn().mockResolvedValue(earliest)
    const { guard } = guardWith(resolve, '2026-11-19')
    const result = await guard.validate(input())
    expect(resolve).toHaveBeenCalledWith({ tenantId: 't-1', organizationId: 'o-1' }, ORDER)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(422)
    expect(result.body).toMatchObject({
      code: ACTIVATION_BEFORE_BILLING_START_CODE,
      earliestActivationDate: '2026-11-20',
    })
    expect(typeof result.body?.error).toBe('string')
    expect(result.body?.error).toContain('2026-11-20')
  })

  it('allows activation on the earliest date and after it', async () => {
    const resolve = jest.fn().mockResolvedValue(earliest)
    expect((await guardWith(resolve, '2026-11-20').guard.validate(input())).ok).toBe(true)
    expect((await guardWith(resolve, '2026-12-01').guard.validate(input())).ok).toBe(true)
  })

  it('leaves renewals / new business untouched (no constraint)', async () => {
    const resolve = jest.fn().mockResolvedValue(null)
    expect((await guardWith(resolve).guard.validate(input())).ok).toBe(true)
  })

  it('ignores other actions on the order without reading anything', async () => {
    const resolve = jest.fn()
    const { guard, container } = guardWith(resolve)
    expect((await guard.validate(input({ mutationPayload: { action: 'transition_status' } }))).ok).toBe(true)
    expect((await guard.validate(input({ mutationPayload: null }))).ok).toBe(true)
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it('falls back to the resource id when the payload carries no order id', async () => {
    const resolve = jest.fn().mockResolvedValue(null)
    await guardWith(resolve).guard.validate(input({ mutationPayload: { action: 'activate' } }))
    expect(resolve).toHaveBeenCalledWith(expect.anything(), ORDER)
  })

  it('passes when the order is missing (CPQ answers the 404) or the read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notFound = jest.fn().mockRejectedValue(Object.assign(new Error('CPQ order not found'), { status: 404 }))
    expect((await guardWith(notFound).guard.validate(input())).ok).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    const broken = jest.fn().mockRejectedValue(new Error('db down'))
    expect((await guardWith(broken).guard.validate(input())).ok).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
