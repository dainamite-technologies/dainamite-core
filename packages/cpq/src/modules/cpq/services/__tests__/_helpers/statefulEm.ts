/**
 * Minimal in-memory EntityManager for characterization tests that need a
 * multi-step service flow (snapshot -> mutate -> snapshot) to see its own
 * writes, which the queue-based `createMockEm` cannot express.
 *
 * - `seed(entity, rows)` registers rows returned by `find` / `findOne`.
 * - `create(entity, data)` returns the data with a deterministic id and
 *   registers it, so later `find` calls see rows created earlier in the flow.
 * - `where` matching supports equality, `$in` and `$nin` (enough for the
 *   inventory service's tenant / deletedAt / status filters).
 */
type Row = Record<string, unknown>

export function createStatefulEm() {
  const tables = new Map<unknown, Row[]>()
  const table = (entity: unknown): Row[] => {
    let rows = tables.get(entity)
    if (!rows) {
      rows = []
      tables.set(entity, rows)
    }
    return rows
  }
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, expected]) => {
      const actual = row[key] ?? null
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        const op = expected as { $in?: unknown[]; $nin?: unknown[] }
        if (op.$in) return op.$in.includes(actual)
        if (op.$nin) return !op.$nin.includes(actual)
      }
      return actual === expected
    })
  let sequence = 0
  const em = {
    fork: jest.fn(),
    seed(entity: unknown, rows: Row[]) {
      table(entity).push(...rows)
    },
    rows: (entity: unknown): Row[] => table(entity),
    find: jest.fn(async (entity: unknown, where: Row) => table(entity).filter((row) => matches(row, where))),
    findOne: jest.fn(async (entity: unknown, where: Row) => table(entity).find((row) => matches(row, where)) ?? null),
    count: jest.fn(async (entity: unknown, where: Row) => table(entity).filter((row) => matches(row, where)).length),
    create: jest.fn((entity: unknown, data: Row) => {
      const row: Row = { deletedAt: null, ...data, id: (data.id as string | undefined) ?? `gen-${++sequence}` }
      table(entity).push(row)
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)
  return em
}
