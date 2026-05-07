import type { TenantScope } from '../../types'

/**
 * Shared MikroORM EntityManager mock for cpqInventoryService /
 * cpqQuotingService / cpqOrderService unit tests.
 *
 * Mirrors the subset of EM surface those services touch:
 *   findOne / find / findAndCount / count / create / persist / flush.
 *
 * `create` returns a shallow-cloned input with a synthetic id when none was
 * supplied — this matches the runtime behavior of `em.create()` returning
 * an entity instance whose primary key gets populated either by user
 * (pre-generated UUID) or by DB default at flush time. ARC tests (which
 * read `result.id` immediately after creation) rely on the synthetic id;
 * pre-existing tests that only inspect `em.create.mock.calls` are unaffected.
 */
export interface MockEm {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<
    (
      entity: unknown,
      where: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown[]>
  >
  findAndCount: jest.MockedFunction<
    (
      entity: unknown,
      where: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<[unknown[], number]>
  >
  count: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<number>>
  create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
  persist: jest.MockedFunction<(entity: unknown) => unknown>
  flush: jest.MockedFunction<() => Promise<void>>
}

let __syntheticIdSequence = 0

export function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_e, data: Record<string, unknown>) => ({
      ...data,
      id: (data.id as string | undefined) ?? `gen-${++__syntheticIdSequence}`,
    })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

export const TEST_SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}
