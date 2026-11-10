const runRouteMutationGuards = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuards(...args),
}))

import { CPQ_QUOTE_RESOURCE_KIND, runCpqMutationGuards } from '../quoteMutationGuard'

describe('runCpqMutationGuards', () => {
  beforeEach(() => {
    runRouteMutationGuards.mockReset()
    runRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: jest.fn() })
  })

  it('forwards the route actor, tenant scope and input to the framework guard runner', async () => {
    const container = { resolve: jest.fn() }
    const req = new Request('http://localhost/api/cpq/quotes/q-1/status', { method: 'POST' })
    const input = {
      resourceKind: CPQ_QUOTE_RESOURCE_KIND,
      resourceId: 'q-1',
      operation: 'custom' as const,
      mutationPayload: { action: 'transition_status', targetStatus: 'with_customer' },
    }

    await runCpqMutationGuards(
      { container: container as never, auth: { sub: 'user-1' } as never, tenantId: 't-1', organizationId: 'org-1' },
      req,
      input,
    )

    expect(runRouteMutationGuards).toHaveBeenCalledWith({
      container,
      req,
      auth: { userId: 'user-1', tenantId: 't-1', organizationId: 'org-1' },
      input,
    })
  })

  it('passes a null organization when the route has none selected', async () => {
    await runCpqMutationGuards(
      { container: {} as never, auth: { sub: 'user-1' } as never, tenantId: 't-1', organizationId: '' },
      new Request('http://localhost/x', { method: 'POST' }),
      { resourceKind: CPQ_QUOTE_RESOURCE_KIND },
    )

    expect(runRouteMutationGuards.mock.calls[0][0].auth.organizationId).toBeNull()
  })
})
