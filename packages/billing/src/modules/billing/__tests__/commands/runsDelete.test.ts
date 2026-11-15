/**
 * Spec F (F1): deleting test / dry Bill Runs and the shared test-run cleanup.
 */

jest.mock('../../events', () => ({ emitBillingEvent: jest.fn(async () => undefined) }))
jest.mock('../../lib/billRunEngine', () => ({ runBillRun: jest.fn() }))

import { emitBillingEvent } from '../../events'
import { deleteRunCommand, runMode } from '../../commands/runs'
import { deleteTestRunArtifacts } from '../../lib/testRunCleanup'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'

type Executed = { sql: string; params: unknown[] }
type RunRow = { id: string; dryRun: boolean; testMode: boolean; status: string }

function createEnv(opts: { run: RunRow | null; testInvoiceIds?: string[] }) {
  const executed: Executed[] = []
  type RunsMockEm = {
    findOne: jest.Mock
    execute: jest.Mock
    transactional: jest.Mock
    fork: jest.Mock
  }
  const em: RunsMockEm = {
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      if (!opts.run) return null
      if (where.tenantId !== TENANT || where.organizationId !== ORG) return null
      return opts.run
    }),
    execute: jest.fn(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params })
      if (sql.trim().startsWith('SELECT id FROM billing_invoices')) {
        return (opts.testInvoiceIds ?? []).map((id) => ({ id }))
      }
      return []
    }),
    transactional: jest.fn(async (fn: (tem: unknown) => Promise<unknown>): Promise<unknown> => fn(em)),
    fork: jest.fn((): unknown => em),
  }
  const ctx = {
    container: { resolve: jest.fn(() => em) },
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    organizationScope: null,
  }
  return { em, ctx, executed }
}

const input = { tenantId: TENANT, organizationId: ORG, billRunId: RUN_ID }

describe('runMode', () => {
  it('maps the run flags to a mode', () => {
    expect(runMode({ dryRun: true, testMode: false })).toBe('dry')
    expect(runMode({ dryRun: false, testMode: true })).toBe('test')
    expect(runMode({ dryRun: false, testMode: false })).toBe('real')
  })
})

describe('deleteRunCommand', () => {
  beforeEach(() => jest.clearAllMocks())

  it('refuses a real run with 422 and touches nothing', async () => {
    const env = createEnv({ run: { id: RUN_ID, dryRun: false, testMode: false, status: 'completed' } })
    await expect(deleteRunCommand.execute(input, env.ctx as never)).rejects.toMatchObject({
      status: 422,
      body: { code: 'billing.run.delete_real_forbidden' },
    })
    expect(env.executed).toHaveLength(0)
    expect(emitBillingEvent).not.toHaveBeenCalled()
  })

  it('refuses a running run with 409', async () => {
    const env = createEnv({ run: { id: RUN_ID, dryRun: false, testMode: true, status: 'running' } })
    await expect(deleteRunCommand.execute(input, env.ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { code: 'billing.run.running' },
    })
  })

  it('returns 404 when the run is missing or belongs to another organization', async () => {
    const env = createEnv({ run: null })
    await expect(deleteRunCommand.execute(input, env.ctx as never)).rejects.toMatchObject({ status: 404 })
  })

  it('deletes a test run: invoices (edits, lines, headers), parent links, outcomes, then the run', async () => {
    const env = createEnv({
      run: { id: RUN_ID, dryRun: false, testMode: true, status: 'completed' },
      testInvoiceIds: ['inv-a', 'inv-b'],
    })
    const result = await deleteRunCommand.execute(input, env.ctx as never)
    expect(result).toEqual({ ok: true, invoicesRemoved: 2 })
    const writes = env.executed.filter((e) => !e.sql.trim().startsWith('SELECT')).map((e) => e.sql.split(/\s+/).slice(0, 3).join(' '))
    expect(writes).toEqual([
      'DELETE FROM billing_draft_invoice_edits',
      'DELETE FROM billing_invoice_lines',
      'DELETE FROM billing_invoices',
      'UPDATE billing_runs SET',
      'DELETE FROM billing_run_outcomes',
      'DELETE FROM billing_runs',
    ])
    // Every write that filters by scope carries tenant + organization.
    const scoped = env.executed.filter((e) => e.sql.includes('tenant_id = ?'))
    for (const row of scoped) {
      expect(row.params.slice(0, 2)).toEqual([TENANT, ORG])
    }
    expect(emitBillingEvent).toHaveBeenCalledWith(
      'billing.run.deleted',
      expect.objectContaining({ billRunId: RUN_ID, mode: 'test', invoicesRemoved: 2 }),
      { persistent: true },
    )
  })

  it('deletes a dry run that wrote no invoices', async () => {
    const env = createEnv({ run: { id: RUN_ID, dryRun: true, testMode: false, status: 'completed' } })
    const result = await deleteRunCommand.execute(input, env.ctx as never)
    expect(result.invoicesRemoved).toBe(0)
    expect(env.executed.some((e) => e.sql.startsWith('DELETE FROM billing_invoices'))).toBe(false)
    expect(env.executed.some((e) => e.sql.startsWith('DELETE FROM billing_runs'))).toBe(true)
  })
})

describe('deleteTestRunArtifacts', () => {
  it('only targets test invoices (never memos or real documents) and scopes by run', async () => {
    const env = createEnv({ run: null, testInvoiceIds: [] })
    await deleteTestRunArtifacts(env.em as never, { tenantId: TENANT, organizationId: ORG, billRunId: RUN_ID })
    const select = env.executed[0]
    expect(select.sql).toContain('test_run = true')
    expect(select.sql).toContain("document_type = 'invoice'")
    expect(select.sql).toContain('bill_run_id = ?')
    expect(select.params).toEqual([TENANT, ORG, RUN_ID])
  })

  it('removes draft-edit audit rows before lines and invoices', async () => {
    const env = createEnv({ run: null, testInvoiceIds: ['x'] })
    expect(await deleteTestRunArtifacts(env.em as never, { tenantId: TENANT, organizationId: ORG })).toBe(1)
    expect(env.executed.slice(1).map((e) => e.sql.split(' ')[2])).toEqual([
      'billing_draft_invoice_edits',
      'billing_invoice_lines',
      'billing_invoices',
    ])
  })
})
