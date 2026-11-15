/**
 * Posting a real run's draft invoices in cursor batches (`billing.runs.post_drafts`).
 */

jest.mock('../../events', () => ({ emitBillingEvent: jest.fn(async () => undefined) }))
jest.mock('../../lib/billRunEngine', () => ({ runBillRun: jest.fn() }))

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { postDraftsCommand } from '../../commands/runs'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type RunRow = { id: string; dryRun: boolean; testMode: boolean; status: string }

function createEnv(opts: { run: RunRow | null; drafts: Array<{ id: string; number: string }>; remaining?: number; failOn?: Record<string, { code: string; error: string }> }) {
  const posted: string[] = []
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const em = {
    findOne: jest.fn(async () => opts.run),
    execute: jest.fn(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params })
      if (sql.includes('COUNT(*)')) return [{ remaining: opts.remaining ?? 0 }]
      return opts.drafts
    }),
    fork: jest.fn((): unknown => em),
  }
  const commandBus = {
    execute: jest.fn(async (_id: string, args: { input: { invoiceId: string } }) => {
      const failure = opts.failOn?.[args.input.invoiceId]
      if (failure) throw new CrudHttpError(409, failure)
      posted.push(args.input.invoiceId)
      return { result: { status: 'posted' } }
    }),
  }
  const ctx = {
    container: { resolve: jest.fn((name: string) => (name === 'commandBus' ? commandBus : em)) },
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    organizationScope: null,
  }
  return { ctx, posted, executed, commandBus }
}

const realRun: RunRow = { id: RUN_ID, dryRun: false, testMode: false, status: 'completed' }
const input = { tenantId: TENANT, organizationId: ORG, billRunId: RUN_ID }

describe('postDraftsCommand', () => {
  it('posts each draft through billing.invoices.post and returns the cursor + remaining', async () => {
    const env = createEnv({ run: realRun, drafts: [{ id: A, number: 'DRAFT-A' }, { id: B, number: 'DRAFT-B' }], remaining: 5 })
    const result = await postDraftsCommand.execute({ ...input, limit: 2 }, env.ctx as never)
    expect(env.posted).toEqual([A, B])
    expect(env.commandBus.execute).toHaveBeenCalledWith('billing.invoices.post', expect.objectContaining({
      input: { tenantId: TENANT, organizationId: ORG, invoiceId: A },
    }))
    expect(result).toEqual({ posted: 2, failed: [], nextCursor: B, remaining: 5, stoppedReason: null })
    // Draft selection is scoped, real-only and keyset-paged.
    const select = env.executed[0]
    expect(select.sql).toContain("status = 'draft'")
    expect(select.sql).toContain('test_run = false')
    expect(select.params).toEqual([TENANT, ORG, RUN_ID, null, null, 2])
  })

  it('reports a failing invoice and carries on with the rest', async () => {
    const env = createEnv({
      run: realRun,
      drafts: [{ id: A, number: 'DRAFT-A' }, { id: B, number: 'DRAFT-B' }, { id: C, number: 'DRAFT-C' }],
      failOn: { [B]: { code: 'billing.invoice.number_conflict', error: 'Number already issued' } },
    })
    const result = await postDraftsCommand.execute(input, env.ctx as never)
    expect(env.posted).toEqual([A, C])
    expect(result.failed).toEqual([
      { invoiceId: B, number: 'DRAFT-B', error: 'Number already issued', code: 'billing.invoice.number_conflict' },
    ])
    expect(result.nextCursor).toBe(C)
  })

  it('stops at incomplete seller settings and keeps the starting cursor', async () => {
    const env = createEnv({
      run: realRun,
      drafts: [{ id: A, number: 'DRAFT-A' }, { id: B, number: 'DRAFT-B' }],
      remaining: 2,
      failOn: { [A]: { code: 'billing.settings.incomplete', error: 'Fill in the seller details' } },
    })
    const result = await postDraftsCommand.execute(input, env.ctx as never)
    expect(env.commandBus.execute).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ posted: 0, stoppedReason: 'billing.settings.incomplete', nextCursor: null, remaining: 2 })
  })

  it('refuses test / dry runs (422), running runs (409) and unknown runs (404)', async () => {
    await expect(
      postDraftsCommand.execute(input, createEnv({ run: { ...realRun, testMode: true }, drafts: [] }).ctx as never),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.run.not_real' } })
    await expect(
      postDraftsCommand.execute(input, createEnv({ run: { ...realRun, status: 'running' }, drafts: [] }).ctx as never),
    ).rejects.toMatchObject({ status: 409 })
    await expect(postDraftsCommand.execute(input, createEnv({ run: null, drafts: [] }).ctx as never)).rejects.toMatchObject({
      status: 404,
    })
  })
})
