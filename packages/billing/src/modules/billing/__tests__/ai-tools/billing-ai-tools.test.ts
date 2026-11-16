/**
 * Billing AI tool pack: registry shape, route coverage, built operations,
 * response mapping and the mutation approval gate.
 *
 * The in-process API operation runner is mocked: every test asserts the exact
 * request a tool sends to the billing route and how it maps the route's
 * response, without loading the routes, the ORM or the DI container.
 */
import type {
  AiApiOperationRequest,
  AiApiOperationResponse,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'

type RunMock = jest.Mock<Promise<AiApiOperationResponse<unknown>>, [AiApiOperationRequest]>

const mockRun: RunMock = jest.fn()
const mockRunnerContexts: Array<{ tool?: { name: string } }> = []

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => ({
  createAiApiOperationRunner: (ctx: { tool?: { name: string } }) => {
    mockRunnerContexts.push(ctx)
    return { run: (request: AiApiOperationRequest) => mockRun(request) }
  },
}))

import { aiTools } from '../../ai-tools'
import { features } from '../../acl'
import { makeToolContext, readRouteFeatures, routeHasOpenApi } from './helpers'

const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const INVOICE_ID = '66666666-6666-4666-8666-666666666666'

function tool(name: string) {
  const found = aiTools.find((entry) => entry.name === name)
  if (!found) throw new Error(`tool ${name} not registered`)
  return found
}

function ok<T>(data: T, statusCode = 200): AiApiOperationResponse<T> {
  return { success: true, statusCode, data }
}

function fail(statusCode: number, error: string): AiApiOperationResponse<unknown> {
  return { success: false, statusCode, error }
}

const pagedEmpty = { items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 }

beforeEach(() => {
  mockRun.mockReset()
  mockRunnerContexts.length = 0
})

/* ------------------------------------------------------------------------ */
/*  Registry                                                                 */
/* ------------------------------------------------------------------------ */

/** Every route each tool calls: [toolName, [[method, routeFile], ...]]. */
const TOOL_ROUTES: Array<[string, Array<[string, string]>]> = [
  ['billing.list_accounts', [['GET', 'api/accounts/route.ts']]],
  ['billing.get_account', [['GET', 'api/accounts/route.ts'], ['GET', 'api/accounts/[id]/summary/route.ts']]],
  ['billing.list_items', [['GET', 'api/items/route.ts']]],
  ['billing.list_usage', [['GET', 'api/usage/route.ts']]],
  ['billing.list_invoices', [['GET', 'api/invoices/route.ts']]],
  ['billing.get_invoice', [['GET', 'api/invoices/[id]/route.ts']]],
  ['billing.list_payments', [['GET', 'api/payments/route.ts']]],
  ['billing.get_payment', [['GET', 'api/payments/[id]/route.ts']]],
  ['billing.list_transactions', [['GET', 'api/transactions/route.ts']]],
  ['billing.list_statements', [['GET', 'api/statements/route.ts']]],
  ['billing.get_statement', [['GET', 'api/statements/route.ts']]],
  ['billing.list_bill_runs', [['GET', 'api/runs/route.ts']]],
  ['billing.get_bill_run', [['GET', 'api/runs/route.ts'], ['GET', 'api/run-outcomes/route.ts']]],
  ['billing.list_run_outcomes', [['GET', 'api/run-outcomes/route.ts']]],
  ['billing.trigger_bill_run', [['POST', 'api/runs/route.ts']]],
  ['billing.record_payment', [['POST', 'api/payments/route.ts']]],
]

describe('billing AI tool registry', () => {
  it('registers exactly the documented tools with unique billing.* names', () => {
    const names = aiTools.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(TOOL_ROUTES.map(([name]) => name).sort())
    for (const name of names) expect(name).toMatch(/^billing\.[a-z_]+$/)
  })

  it('gives every tool a description and non-empty requiredFeatures declared in acl.ts', () => {
    const declared = new Set(features.map((feature) => feature.id))
    for (const entry of aiTools) {
      expect(entry.description.length).toBeGreaterThan(20)
      expect(entry.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of entry.requiredFeatures ?? []) expect(declared.has(feature)).toBe(true)
    }
  })

  it.each(TOOL_ROUTES)('%s requiredFeatures cover every backing route', async (name, routes) => {
    const entry = tool(name)
    for (const [method, routeFile] of routes) {
      const routeFeatures = await readRouteFeatures(routeFile, method)
      expect(routeFeatures.length).toBeGreaterThan(0)
      for (const feature of routeFeatures) expect(entry.requiredFeatures).toContain(feature)
      // The operation runner refuses undocumented routes.
      await expect(routeHasOpenApi(routeFile)).resolves.toBe(true)
    }
  })

  it('flags only the two write tools as mutations, both destructive with a preview resolver', () => {
    const mutations = aiTools.filter((entry) => entry.isMutation === true).map((entry) => entry.name)
    expect(mutations.sort()).toEqual(['billing.record_payment', 'billing.trigger_bill_run'])
    for (const name of mutations) {
      const entry = tool(name)
      expect(entry.isDestructive).toBe(true)
      expect(typeof entry.loadBeforeRecord).toBe('function')
    }
  })

  it('caps every list tool at 100 rows', () => {
    for (const entry of aiTools.filter((candidate) => candidate.name.startsWith('billing.list_'))) {
      expect(entry.inputSchema.safeParse({ limit: 100 }).success).toBe(true)
      expect(entry.inputSchema.safeParse({ limit: 101 }).success).toBe(false)
      expect(entry.inputSchema.safeParse({ limit: 0 }).success).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------------ */
/*  Read tools                                                               */
/* ------------------------------------------------------------------------ */

describe('billing list tools', () => {
  it('billing.list_accounts maps filters onto GET /billing/accounts', async () => {
    mockRun.mockResolvedValueOnce(ok({ items: [{ id: ACCOUNT_ID, name: 'Acme' }], total: 1, page: 2, pageSize: 10, totalPages: 1 }))
    const input = tool('billing.list_accounts').inputSchema.parse({
      limit: 10,
      page: 2,
      search: ' Acme ',
      currencyCode: 'eur',
      billingMode: 'prepaid',
      activeOnly: true,
      hasOverdue: false,
    })
    const result = await tool('billing.list_accounts').handler(input, makeToolContext())
    expect(mockRun).toHaveBeenCalledWith({
      method: 'GET',
      path: '/billing/accounts',
      query: {
        page: 2,
        pageSize: 10,
        search: 'Acme',
        currencyCode: 'EUR',
        billingMode: 'prepaid',
        isActive: 'true',
        hasOverdue: 'false',
      },
    })
    expect(result).toEqual({ items: [{ id: ACCOUNT_ID, name: 'Acme' }], total: 1, page: 2, pageSize: 10, totalPages: 1 })
    // The runner context carries the tool so the route-feature check works.
    expect(mockRunnerContexts[0]?.tool?.name).toBe('billing.list_accounts')
  })

  it('never sends isActive=false (the route would coerce it to true)', async () => {
    mockRun.mockResolvedValueOnce(ok(pagedEmpty))
    const input = tool('billing.list_accounts').inputSchema.parse({ activeOnly: false })
    await tool('billing.list_accounts').handler(input, makeToolContext())
    expect(mockRun.mock.calls[0][0].query).toEqual({ page: 1, pageSize: 25 })
  })

  it('billing.list_invoices sends testRun / overdue as literal booleans', async () => {
    mockRun.mockResolvedValueOnce(ok(pagedEmpty))
    const input = tool('billing.list_invoices').inputSchema.parse({
      status: 'posted',
      testRun: false,
      overdue: true,
      dueTo: '2026-11-30',
      billAccountId: ACCOUNT_ID,
    })
    await tool('billing.list_invoices').handler(input, makeToolContext())
    expect(mockRun.mock.calls[0][0]).toEqual({
      method: 'GET',
      path: '/billing/invoices',
      query: {
        page: 1,
        pageSize: 25,
        status: 'posted',
        billAccountId: ACCOUNT_ID,
        testRun: 'false',
        overdue: 'true',
        dueTo: '2026-11-30',
      },
    })
  })

  it('rejects malformed filters before calling the route', () => {
    expect(tool('billing.list_invoices').inputSchema.safeParse({ status: 'void' }).success).toBe(false)
    expect(tool('billing.list_invoices').inputSchema.safeParse({ dueFrom: '30.11.2026' }).success).toBe(false)
    expect(tool('billing.list_items').inputSchema.safeParse({ billAccountId: 'not-a-uuid' }).success).toBe(false)
    expect(tool('billing.list_bill_runs').inputSchema.safeParse({ mode: 'live' }).success).toBe(false)
  })

  it.each([
    ['billing.list_items', '/billing/items', { type: 'recurring', activeAt: '2026-11-01' }, { type: 'recurring', activeAt: '2026-11-01' }],
    ['billing.list_usage', '/billing/usage', { uomCode: 'GB', ratedOnly: true }, { uomCode: 'GB', rated: 'true' }],
    ['billing.list_payments', '/billing/payments', { status: 'unmatched', receivedFrom: '2026-10-01' }, { status: 'unmatched', receivedFrom: '2026-10-01' }],
    ['billing.list_transactions', '/billing/transactions', { type: 'topup' }, { type: 'topup' }],
    ['billing.list_statements', '/billing/statements', { status: 'sent' }, { status: 'sent' }],
    ['billing.list_bill_runs', '/billing/runs', { mode: 'dry', status: 'failed' }, { mode: 'dry', status: 'failed' }],
    ['billing.list_run_outcomes', '/billing/run-outcomes', { billRunId: RUN_ID, status: 'failed' }, { billRunId: RUN_ID, status: 'failed' }],
  ])('%s calls GET %s with the mapped filters', async (name, path, rawInput, expectedFilters) => {
    mockRun.mockResolvedValueOnce(ok(pagedEmpty))
    const input = tool(name).inputSchema.parse(rawInput)
    const result = await tool(name).handler(input, makeToolContext())
    expect(mockRun).toHaveBeenCalledWith({ method: 'GET', path, query: { page: 1, pageSize: 25, ...expectedFilters } })
    expect(result).toEqual(pagedEmpty)
  })

  it('surfaces a route failure as a tool error', async () => {
    mockRun.mockResolvedValueOnce(fail(403, 'Forbidden'))
    const input = tool('billing.list_payments').inputSchema.parse({})
    await expect(tool('billing.list_payments').handler(input, makeToolContext())).rejects.toThrow('Forbidden')
  })

  it('refuses to run without a tenant', async () => {
    const input = tool('billing.list_accounts').inputSchema.parse({})
    await expect(
      tool('billing.list_accounts').handler(input, makeToolContext({ tenantId: null })),
    ).rejects.toThrow(/Tenant context/)
    expect(mockRun).not.toHaveBeenCalled()
  })
})

describe('billing get tools', () => {
  it('billing.get_account combines the account row with its summary', async () => {
    mockRun
      .mockResolvedValueOnce(ok({ items: [{ id: ACCOUNT_ID, name: 'Acme' }], total: 1 }))
      .mockResolvedValueOnce(ok({ open_total: '120.0000', billing_mode: 'postpaid' }))
    const result = await tool('billing.get_account').handler({ accountId: ACCOUNT_ID }, makeToolContext())
    expect(mockRun.mock.calls.map(([request]) => request)).toEqual([
      { method: 'GET', path: '/billing/accounts', query: { id: ACCOUNT_ID, page: 1, pageSize: 1 } },
      { method: 'GET', path: `/billing/accounts/${ACCOUNT_ID}/summary` },
    ])
    expect(result).toEqual({
      found: true,
      account: { id: ACCOUNT_ID, name: 'Acme' },
      summary: { open_total: '120.0000', billing_mode: 'postpaid' },
    })
  })

  it('billing.get_account returns found:false for an empty list', async () => {
    mockRun.mockResolvedValueOnce(ok(pagedEmpty))
    await expect(tool('billing.get_account').handler({ accountId: ACCOUNT_ID }, makeToolContext())).resolves.toEqual({
      found: false,
      accountId: ACCOUNT_ID,
    })
    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  it('billing.get_invoice strips metadata and party snapshots by default', async () => {
    mockRun.mockResolvedValueOnce(
      ok({
        invoice: { id: INVOICE_ID, number: 'FV/1', metadata: { x: 1 }, buyer_snapshot: { name: 'B' }, seller_snapshot: { name: 'S' } },
        lines: [{ id: 'l1', description: 'Plan', metadata: { y: 2 } }],
        allocations: [{ id: 'a1' }],
        corrections: [],
      }),
    )
    const result = await tool('billing.get_invoice').handler({ invoiceId: INVOICE_ID }, makeToolContext())
    expect(mockRun).toHaveBeenCalledWith({ method: 'GET', path: `/billing/invoices/${INVOICE_ID}` })
    expect(result).toEqual({
      found: true,
      invoice: { id: INVOICE_ID, number: 'FV/1' },
      lines: [{ id: 'l1', description: 'Plan' }],
      allocations: [{ id: 'a1' }],
      corrections: [],
    })
  })

  it('billing.get_invoice keeps party snapshots on request and maps 404 to found:false', async () => {
    mockRun.mockResolvedValueOnce(ok({ invoice: { id: INVOICE_ID, buyer_snapshot: { name: 'B' } }, lines: [] }))
    const withParties = await tool('billing.get_invoice').handler(
      { invoiceId: INVOICE_ID, includeParties: true },
      makeToolContext(),
    )
    expect(withParties).toMatchObject({ found: true, invoice: { buyer_snapshot: { name: 'B' } } })

    mockRun.mockResolvedValueOnce(fail(404, 'Invoice not found'))
    await expect(tool('billing.get_invoice').handler({ invoiceId: INVOICE_ID }, makeToolContext())).resolves.toEqual({
      found: false,
      invoiceId: INVOICE_ID,
    })
  })

  it('billing.get_bill_run returns the run with its first outcomes', async () => {
    mockRun
      .mockResolvedValueOnce(ok({ items: [{ id: RUN_ID, status: 'completed', dry_run: true }], total: 1 }))
      .mockResolvedValueOnce(ok({ items: [{ id: 'o1', status: 'success' }], total: 7, page: 1, pageSize: 5, totalPages: 2 }))
    const result = await tool('billing.get_bill_run').handler({ billRunId: RUN_ID, outcomesLimit: 5 }, makeToolContext())
    expect(mockRun.mock.calls[1][0]).toEqual({
      method: 'GET',
      path: '/billing/run-outcomes',
      query: { billRunId: RUN_ID, page: 1, pageSize: 5 },
    })
    expect(result).toEqual({
      found: true,
      run: { id: RUN_ID, status: 'completed', dry_run: true },
      outcomes: [{ id: 'o1', status: 'success' }],
      outcomesTotal: 7,
    })
  })

  it('billing.get_payment and billing.get_statement map their routes', async () => {
    mockRun.mockResolvedValueOnce(ok({ payment: { id: 'p1', amount: '10.0000' }, allocations: [{ id: 'al1' }] }))
    await expect(tool('billing.get_payment').handler({ paymentId: ACCOUNT_ID }, makeToolContext())).resolves.toEqual({
      found: true,
      payment: { id: 'p1', amount: '10.0000' },
      allocations: [{ id: 'al1' }],
    })
    expect(mockRun.mock.calls[0][0]).toEqual({ method: 'GET', path: `/billing/payments/${ACCOUNT_ID}` })

    mockRun.mockResolvedValueOnce(ok({ items: [{ id: 's1', closing_balance: '5.0000' }], total: 1 }))
    await expect(tool('billing.get_statement').handler({ statementId: ACCOUNT_ID }, makeToolContext())).resolves.toEqual({
      found: true,
      statement: { id: 's1', closing_balance: '5.0000' },
    })
    expect(mockRun.mock.calls[1][0]).toEqual({
      method: 'GET',
      path: '/billing/statements',
      query: { id: ACCOUNT_ID, page: 1, pageSize: 1 },
    })
  })
})

/* ------------------------------------------------------------------------ */
/*  Mutation tools                                                           */
/* ------------------------------------------------------------------------ */

describe('billing.trigger_bill_run', () => {
  const triggerTool = () => tool('billing.trigger_bill_run')

  it('accepts only dry and test modes and rejects unknown keys', () => {
    expect(triggerTool().inputSchema.safeParse({ mode: 'dry' }).success).toBe(true)
    expect(triggerTool().inputSchema.safeParse({ mode: 'test', asOfDate: '2026-11-30' }).success).toBe(true)
    expect(triggerTool().inputSchema.safeParse({ mode: 'real' }).success).toBe(false)
    expect(triggerTool().inputSchema.safeParse({}).success).toBe(false)
    expect(triggerTool().inputSchema.safeParse({ mode: 'dry', catchUp: true }).success).toBe(false)
  })

  it('builds a preview without calling any route', async () => {
    const preview = await triggerTool().loadBeforeRecord!({ mode: 'test', scopedAccountIds: [ACCOUNT_ID] }, makeToolContext())
    expect(preview).toMatchObject({
      entityType: 'billing:billing_run',
      recordVersion: null,
      before: {},
      after: { mode: 'test', asOfDate: null, scopedAccountIds: [ACCOUNT_ID] },
    })
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('fails closed without an approved pending action', async () => {
    await expect(triggerTool().handler({ mode: 'dry' }, makeToolContext())).rejects.toThrow(/approval card/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('posts the run to /billing/runs once approved', async () => {
    mockRun.mockResolvedValueOnce(ok({ billRunId: RUN_ID, status: 'completed', outcomesCount: 3 }, 201))
    const result = await triggerTool().handler(
      { mode: 'dry', asOfDate: '2026-11-30' },
      makeToolContext({ approvedPendingActionId: 'pa-1' }),
    )
    expect(mockRun).toHaveBeenCalledWith({
      method: 'POST',
      path: '/billing/runs',
      body: { mode: 'dry', asOfDate: '2026-11-30' },
    })
    expect(result).toEqual({ billRunId: RUN_ID, status: 'completed', outcomesCount: 3, mode: 'dry' })
  })

  it('re-validates the input at execution time (never a real run)', async () => {
    await expect(
      triggerTool().handler({ mode: 'real' } as never, makeToolContext({ approvedPendingActionId: 'pa-1' })),
    ).rejects.toThrow()
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('surfaces the run lock error', async () => {
    mockRun.mockResolvedValueOnce(fail(409, 'billing.run.lock_busy'))
    await expect(
      triggerTool().handler({ mode: 'test' }, makeToolContext({ approvedPendingActionId: 'pa-1' })),
    ).rejects.toThrow('billing.run.lock_busy')
  })
})

describe('billing.record_payment', () => {
  const paymentTool = () => tool('billing.record_payment')
  const valid = { receivedAt: '2026-11-15', amount: 120.5, currencyCode: 'eur', billAccountId: ACCOUNT_ID }

  it('validates the payment input', () => {
    expect(paymentTool().inputSchema.safeParse(valid).success).toBe(true)
    expect(paymentTool().inputSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false)
    expect(paymentTool().inputSchema.safeParse({ ...valid, receivedAt: '15.11.2026' }).success).toBe(false)
    expect(paymentTool().inputSchema.safeParse({ ...valid, currencyCode: 'EURO' }).success).toBe(false)
    expect(paymentTool().inputSchema.safeParse({ ...valid, status: 'allocated' }).success).toBe(false)
  })

  it('previews the new payment', async () => {
    const preview = await paymentTool().loadBeforeRecord!(paymentTool().inputSchema.parse(valid), makeToolContext())
    expect(preview).toMatchObject({
      entityType: 'billing:billing_payment',
      before: {},
      after: { receivedAt: '2026-11-15', amount: 120.5, currencyCode: 'EUR', billAccountId: ACCOUNT_ID },
    })
  })

  it('fails closed without approval and posts once approved', async () => {
    const input = paymentTool().inputSchema.parse(valid)
    await expect(paymentTool().handler(input, makeToolContext())).rejects.toThrow(/approval card/)
    expect(mockRun).not.toHaveBeenCalled()

    mockRun.mockResolvedValueOnce(ok({ paymentId: 'p1', status: 'matched', unallocatedAmount: '0.0000' }))
    const result = await paymentTool().handler(input, makeToolContext({ approvedPendingActionId: 'pa-2' }))
    expect(mockRun).toHaveBeenCalledWith({
      method: 'POST',
      path: '/billing/payments',
      body: { receivedAt: '2026-11-15', amount: 120.5, currencyCode: 'EUR', billAccountId: ACCOUNT_ID },
    })
    expect(result).toEqual({ paymentId: 'p1', status: 'matched', unallocatedAmount: '0.0000' })
  })
})
