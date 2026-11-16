import { cpqContextError, type CpqRouteContext } from '../context'

const base = {
  tenantId: 'tenant',
  organizationId: 'org',
  auth: { sub: 'user' },
  translate: (_key: string, fallback?: string) => fallback ?? _key,
} as unknown as CpqRouteContext

describe('cpqContextError', () => {
  it('lets a scoped, authenticated context through', () => {
    expect(cpqContextError(base)).toBeNull()
  })

  it('answers 401 without auth', () => {
    expect(cpqContextError({ ...base, auth: null } as CpqRouteContext)?.status).toBe(401)
  })

  it('answers 400 instead of querying with an empty organization id', async () => {
    const response = cpqContextError({ ...base, organizationId: '' })
    expect(response?.status).toBe(400)
    expect((await response!.json()).error).toMatch(/Organization context is required/)
  })
})
