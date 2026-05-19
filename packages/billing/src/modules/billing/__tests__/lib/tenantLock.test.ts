import {
  buildLockKey,
  TenantLockBusyError,
  withTenantLock,
} from '../../lib/tenantLock'

type MockEm = {
  transactional: jest.MockedFunction<
    (fn: (tem: MockEm) => Promise<unknown>) => Promise<unknown>
  >
  execute: jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<unknown>>
}

function createMockEm(): MockEm {
  const em: MockEm = {
    transactional: jest.fn(async (fn) => fn(em)),
    execute: jest.fn(),
  }
  return em
}

const TENANT_A = '00000000-0000-0000-0000-000000000001'
const TENANT_B = '00000000-0000-0000-0000-000000000002'

describe('buildLockKey', () => {
  it('builds a stable, namespaced key', () => {
    expect(buildLockKey(TENANT_A, 'billing-run')).toBe(
      `dainamite-billing:${TENANT_A}:billing-run`,
    )
  })

  it('returns distinct keys per tenant', () => {
    expect(buildLockKey(TENANT_A, 'billing-run')).not.toEqual(
      buildLockKey(TENANT_B, 'billing-run'),
    )
  })

  it('returns distinct keys per lockName', () => {
    expect(buildLockKey(TENANT_A, 'billing-run')).not.toEqual(
      buildLockKey(TENANT_A, 'other-job'),
    )
  })
})

describe('withTenantLock', () => {
  it('runs the callback when the advisory lock is acquired', async () => {
    const em = createMockEm()
    em.execute.mockResolvedValueOnce([{ acquired: true }])

    const inner = jest.fn(async () => 'work-result')
    const result = await withTenantLock(
      em as never,
      { tenantId: TENANT_A, lockName: 'billing-run' },
      inner,
    )

    expect(result).toBe('work-result')
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.execute).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('passes the expected lock key into pg_try_advisory_xact_lock', async () => {
    const em = createMockEm()
    em.execute.mockResolvedValueOnce([{ acquired: true }])

    await withTenantLock(
      em as never,
      { tenantId: TENANT_A, lockName: 'billing-run' },
      async () => 'ok',
    )

    const [sql, params] = em.execute.mock.calls[0]
    expect(sql).toMatch(/pg_try_advisory_xact_lock/i)
    expect(sql).toMatch(/hashtext/i)
    expect(params).toEqual([buildLockKey(TENANT_A, 'billing-run')])
  })

  it('throws TenantLockBusyError when the lock is already held', async () => {
    const em = createMockEm()
    em.execute.mockResolvedValueOnce([{ acquired: false }])

    const inner = jest.fn(async () => 'should-not-run')

    await expect(
      withTenantLock(
        em as never,
        { tenantId: TENANT_A, lockName: 'billing-run' },
        inner,
      ),
    ).rejects.toBeInstanceOf(TenantLockBusyError)

    expect(inner).not.toHaveBeenCalled()
  })

  it('TenantLockBusyError carries tenantId + lockName for HTTP 409 mapping', async () => {
    const em = createMockEm()
    em.execute.mockResolvedValueOnce([{ acquired: false }])

    try {
      await withTenantLock(
        em as never,
        { tenantId: TENANT_A, lockName: 'billing-run' },
        async () => 'never',
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TenantLockBusyError)
      const lockErr = err as TenantLockBusyError
      expect(lockErr.tenantId).toBe(TENANT_A)
      expect(lockErr.lockName).toBe('billing-run')
    }
  })

  it('tolerates the driver returning a single row object instead of an array', async () => {
    const em = createMockEm()
    em.execute.mockResolvedValueOnce({ acquired: true } as never)

    const result = await withTenantLock(
      em as never,
      { tenantId: TENANT_A, lockName: 'billing-run' },
      async () => 'ok',
    )
    expect(result).toBe('ok')
  })
})
