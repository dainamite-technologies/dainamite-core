/**
 * Unit tests for the Phase 4a + 4b invoice commands.
 *
 * These exercise the *command contract* — refusal on non-draft,
 * audit-row writing, totals recompute — via a thin mocked EM. Real
 * end-to-end persistence is covered by the integration suite once
 * Phase 4c admin UI lands and Playwright can drive the flow.
 *
 * The mock EM models the subset of operations the commands touch:
 *   findOne / find / create / persist / flush / remove / execute.
 * `create` returns a shallow copy with a synthetic id so the
 * command's `emit / return` path can read `result.id` immediately.
 */

import {
  __resetInvoiceStatusCacheForTests,
} from '../../lib/invoiceStatus'
import {
  addDraftLineCommand,
  editDraftLineCommand,
  postInvoiceCommand,
  removeDraftLineCommand,
  wipeTestInvoicesCommand,
} from '../../commands/invoices'
import {
  DraftInvoiceEdit,
} from '../../data/entities'

type FakeInvoice = {
  id: string
  status: string
  statusEntryId: string | null
  tenantId: string
  organizationId: string
  invoiceNumber: string
  currencyCode: string
  metadata: Record<string, unknown> | null
  subtotalNetAmount: string
  subtotalGrossAmount: string
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  outstandingAmount: string
  paidTotalAmount: string
  updatedAt: Date
  deletedAt: Date | null
}

type FakeLine = {
  id: string
  invoice: FakeInvoice
  tenantId: string
  organizationId: string
  description: string | null
  quantity: string
  normalizedQuantity: string
  unitPriceNet: string
  unitPriceGross: string
  totalNetAmount: string
  totalGrossAmount: string
  metadata: Record<string, unknown> | null
  lineNumber: number
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const INVOICE_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'

function makeInvoice(overrides: Partial<FakeInvoice> = {}): FakeInvoice {
  return {
    id: overrides.id ?? INVOICE_ID,
    status: overrides.status ?? 'draft',
    statusEntryId: overrides.statusEntryId ?? 'status-draft',
    tenantId: overrides.tenantId ?? TENANT,
    organizationId: overrides.organizationId ?? ORG,
    invoiceNumber: overrides.invoiceNumber ?? 'INV-2026-0000001',
    currencyCode: overrides.currencyCode ?? 'EUR',
    metadata: overrides.metadata ?? {},
    subtotalNetAmount: overrides.subtotalNetAmount ?? '100.0000',
    subtotalGrossAmount: overrides.subtotalGrossAmount ?? '100.0000',
    grandTotalNetAmount: overrides.grandTotalNetAmount ?? '100.0000',
    grandTotalGrossAmount: overrides.grandTotalGrossAmount ?? '100.0000',
    outstandingAmount: overrides.outstandingAmount ?? '100.0000',
    paidTotalAmount: overrides.paidTotalAmount ?? '0',
    updatedAt: overrides.updatedAt ?? new Date(),
    deletedAt: overrides.deletedAt ?? null,
  }
}

function makeLine(invoice: FakeInvoice, overrides: Partial<FakeLine> = {}): FakeLine {
  return {
    id: overrides.id ?? LINE_ID,
    invoice,
    tenantId: invoice.tenantId,
    organizationId: invoice.organizationId,
    description: overrides.description ?? 'MRC',
    quantity: overrides.quantity ?? '1.0000',
    normalizedQuantity: overrides.normalizedQuantity ?? '1.0000',
    unitPriceNet: overrides.unitPriceNet ?? '100.0000',
    unitPriceGross: overrides.unitPriceGross ?? '100.0000',
    totalNetAmount: overrides.totalNetAmount ?? '100.0000',
    totalGrossAmount: overrides.totalGrossAmount ?? '100.0000',
    metadata: overrides.metadata ?? { billing_type: 'recurring' },
    lineNumber: overrides.lineNumber ?? 1,
  }
}

type Env = {
  ctx: { container: { resolve: jest.MockedFunction<(name: string) => unknown> }; auth: { sub?: string } | null }
  em: {
    findOne: jest.MockedFunction<(entity: unknown, where: unknown) => Promise<unknown>>
    find: jest.MockedFunction<(entity: unknown, where: unknown) => Promise<unknown[]>>
    create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
    persist: jest.MockedFunction<(entity: unknown) => unknown>
    flush: jest.MockedFunction<() => Promise<void>>
    remove: jest.MockedFunction<(entity: unknown) => unknown>
    execute: jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<unknown>>
    fork: jest.MockedFunction<() => Env['em']>
  }
  persistedEntities: unknown[]
  removedEntities: unknown[]
}

let auditIdCounter = 0

function createEnv(
  options: {
    invoice?: FakeInvoice | null
    line?: FakeLine | null
    statusEntryDraft?: string | null
    statusEntryPosted?: string | null
    initialLines?: FakeLine[]
    invoiceFinalLines?: FakeLine[]
    auth?: { sub?: string } | null
    testInvoiceRows?: Array<{ id: string }>
  } = {},
): Env {
  const persistedEntities: unknown[] = []
  const removedEntities: unknown[] = []
  let lineSequence = (options.initialLines ?? []).length

  const em: Env['em'] = {
    findOne: jest.fn(async (entity: unknown, _where: unknown) => {
      // Distinguish by entity reference. Order of priority:
      // SalesInvoice → Dictionary / DictionaryEntry (via invoiceStatus
      // resolver — returns dict then entry) → SalesInvoiceLine.
      const constructorName = (entity as { name?: string }).name ?? ''
      if (constructorName === 'SalesInvoice') return options.invoice ?? null
      if (constructorName === 'SalesInvoiceLine') return options.line ?? null
      if (constructorName === 'Dictionary') return { id: 'dict-1' }
      if (constructorName === 'DictionaryEntry') {
        // The status resolver looks up by value; assume posted for the
        // post test (the only one that exercises this path).
        return { id: options.statusEntryPosted ?? 'entry-posted' }
      }
      return null
    }) as never,
    find: jest.fn(async (entity: unknown, _where: unknown) => {
      const constructorName = (entity as { name?: string }).name ?? ''
      if (constructorName === 'SalesInvoiceLine') {
        // For add-line: return initialLines so lineNumber is computed.
        // For recomputeInvoiceTotals: return invoiceFinalLines after edit.
        if (options.invoiceFinalLines) return options.invoiceFinalLines
        return options.initialLines ?? []
      }
      return []
    }) as never,
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const ctor = (entity as { name?: string }).name ?? ''
      if (ctor === 'DraftInvoiceEdit') {
        auditIdCounter += 1
        return { ...data, id: `audit-${auditIdCounter}` }
      }
      if (ctor === 'SalesInvoiceLine') {
        lineSequence += 1
        return { ...data, id: `new-line-${lineSequence}` }
      }
      return { ...data, id: 'generated-id' }
    }) as never,
    persist: jest.fn((entity: unknown) => {
      persistedEntities.push(entity)
    }) as never,
    flush: jest.fn(async () => undefined) as never,
    remove: jest.fn((entity: unknown) => {
      removedEntities.push(entity)
    }) as never,
    execute: jest.fn(async () => options.testInvoiceRows ?? []) as never,
    fork: jest.fn() as never,
  }
  em.fork = jest.fn(() => em) as never

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      return null
    }) as never,
  }

  return {
    ctx: {
      container,
      auth: options.auth ?? { sub: '99999999-9999-4999-8999-999999999999' },
    },
    em,
    persistedEntities,
    removedEntities,
  }
}

beforeEach(() => {
  __resetInvoiceStatusCacheForTests()
  auditIdCounter = 0
})

const baseInput = {
  tenantId: TENANT,
  organizationId: ORG,
  invoiceId: INVOICE_ID,
}

describe('postInvoiceCommand', () => {
  it('refuses non-draft invoices with 409 + not_draft code', async () => {
    const env = createEnv({ invoice: makeInvoice({ status: 'posted' }) })
    await expect(
      postInvoiceCommand.execute(baseInput, env.ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'billing.invoice.not_draft' }),
    })
  })

  it('refuses test_run=true invoices with 409 + test_run code', async () => {
    const env = createEnv({
      invoice: makeInvoice({ status: 'draft', metadata: { test_run: true } }),
    })
    await expect(
      postInvoiceCommand.execute(baseInput, env.ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'billing.invoice.test_run' }),
    })
  })

  it('happy path: draft → posted, status_entry_id resolved', async () => {
    const invoice = makeInvoice({ status: 'draft' })
    const env = createEnv({ invoice, initialLines: [makeLine(invoice)] })
    const result = await postInvoiceCommand.execute(baseInput, env.ctx as never)
    expect(result.status).toBe('posted')
    expect(invoice.status).toBe('posted')
    expect(result.lineCount).toBe(1)
  })

  it('throws 404 when the invoice does not exist for this scope', async () => {
    const env = createEnv({ invoice: null })
    await expect(
      postInvoiceCommand.execute(baseInput, env.ctx as never),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('editDraftLineCommand', () => {
  it('refuses non-draft invoices', async () => {
    const invoice = makeInvoice({ status: 'posted' })
    const env = createEnv({ invoice })
    await expect(
      editDraftLineCommand.execute(
        { ...baseInput, invoiceLineId: LINE_ID, changes: { description: 'x' } },
        env.ctx as never,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'billing.invoice.not_draft' }),
    })
  })

  it('updates description + recomputes line total from unit_price × quantity', async () => {
    const invoice = makeInvoice({ status: 'draft' })
    const line = makeLine(invoice, {
      quantity: '1.0000',
      unitPriceNet: '50.0000',
      totalNetAmount: '50.0000',
    })
    const env = createEnv({
      invoice,
      line,
      invoiceFinalLines: [line],
    })

    await editDraftLineCommand.execute(
      {
        ...baseInput,
        invoiceLineId: LINE_ID,
        changes: { quantity: 3, unitPriceNet: 60 },
      },
      env.ctx as never,
    )

    expect(line.quantity).toBe('3.0000')
    expect(line.unitPriceNet).toBe('60.0000')
    // 3 × 60 = 180
    expect(line.totalNetAmount).toBe('180.0000')
    // Invoice totals match the new line sum.
    expect(invoice.grandTotalNetAmount).toBe('180.0000')
  })

  it('honours explicit totalNetAmount override (operator manual fix)', async () => {
    const invoice = makeInvoice({ status: 'draft' })
    const line = makeLine(invoice, { quantity: '1.0000', unitPriceNet: '50.0000' })
    const env = createEnv({ invoice, line, invoiceFinalLines: [line] })
    await editDraftLineCommand.execute(
      {
        ...baseInput,
        invoiceLineId: LINE_ID,
        changes: { totalNetAmount: 999.99 },
      },
      env.ctx as never,
    )
    expect(line.totalNetAmount).toBe('999.9900')
  })

  it('persists a DraftInvoiceEdit audit row with before+after snapshots', async () => {
    const invoice = makeInvoice({ status: 'draft' })
    const line = makeLine(invoice, {
      description: 'Old',
      totalNetAmount: '50.0000',
    })
    const env = createEnv({ invoice, line, invoiceFinalLines: [line] })

    await editDraftLineCommand.execute(
      {
        ...baseInput,
        invoiceLineId: LINE_ID,
        changes: { description: 'New' },
      },
      env.ctx as never,
    )

    const audit = env.persistedEntities.find(
      (e) => (e as { action?: string }).action === 'line_edited',
    ) as Record<string, unknown> | undefined
    expect(audit).toBeDefined()
    expect((audit?.beforeJson as { description: string }).description).toBe('Old')
    expect((audit?.afterJson as { description: string }).description).toBe('New')
  })

  it('returns 404 when the line is not on the invoice', async () => {
    const invoice = makeInvoice({ status: 'draft' })
    const env = createEnv({ invoice, line: null })
    await expect(
      editDraftLineCommand.execute(
        { ...baseInput, invoiceLineId: LINE_ID, changes: { description: 'x' } },
        env.ctx as never,
      ),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('addDraftLineCommand', () => {
  it('appends a line with the next lineNumber and writes a line_added audit', async () => {
    const invoice = makeInvoice({ status: 'draft' })
    const existing = [makeLine(invoice), makeLine(invoice, { id: 'l2' })]
    const env = createEnv({
      invoice,
      initialLines: existing,
      invoiceFinalLines: [...existing],
    })

    const result = await addDraftLineCommand.execute(
      {
        ...baseInput,
        description: 'Manual adjustment',
        quantity: 2,
        unitPriceNet: 25,
      },
      env.ctx as never,
    )
    expect(result.invoiceLineId).toBe('new-line-3')
    const audit = env.persistedEntities.find(
      (e) => (e as { action?: string }).action === 'line_added',
    ) as Record<string, unknown> | undefined
    expect(audit).toBeDefined()
    expect(audit?.beforeJson).toBeNull()
    expect(audit?.afterJson).toBeDefined()
  })

  it('refuses non-draft invoices', async () => {
    const env = createEnv({ invoice: makeInvoice({ status: 'paid' }) })
    await expect(
      addDraftLineCommand.execute(
        {
          ...baseInput,
          description: 'x',
          quantity: 1,
          unitPriceNet: 1,
        },
        env.ctx as never,
      ),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('removeDraftLineCommand', () => {
  it('removes the line and writes a line_removed audit with before snapshot', async () => {
    const invoice = makeInvoice({ status: 'draft' })
    const line = makeLine(invoice, { description: 'Going away' })
    const env = createEnv({ invoice, line, invoiceFinalLines: [] })

    await removeDraftLineCommand.execute(
      { ...baseInput, invoiceLineId: LINE_ID },
      env.ctx as never,
    )

    expect(env.removedEntities).toContain(line)
    const audit = env.persistedEntities.find(
      (e) => (e as { action?: string }).action === 'line_removed',
    ) as Record<string, unknown> | undefined
    expect(audit).toBeDefined()
    expect((audit?.beforeJson as { description: string }).description).toBe('Going away')
    expect(audit?.afterJson).toBeNull()
    expect(audit?.invoiceLineId).toBeNull()
    // Invoice total reset to zero (no lines left).
    expect(invoice.grandTotalNetAmount).toBe('0.0000')
  })
})

describe('wipeTestInvoicesCommand', () => {
  it('returns 0 when no test invoices match', async () => {
    const env = createEnv({ testInvoiceRows: [] })
    const result = await wipeTestInvoicesCommand.execute(
      { tenantId: TENANT, organizationId: ORG },
      env.ctx as never,
    )
    expect(result.invoicesRemoved).toBe(0)
  })

  it('deletes lines then invoices when matches exist', async () => {
    const env = createEnv({
      testInvoiceRows: [{ id: 'test-inv-1' }, { id: 'test-inv-2' }],
    })
    const result = await wipeTestInvoicesCommand.execute(
      { tenantId: TENANT, organizationId: ORG },
      env.ctx as never,
    )
    expect(result.invoicesRemoved).toBe(2)
    // 1 SELECT + 1 DELETE lines + 1 DELETE invoices
    expect(env.em.execute).toHaveBeenCalledTimes(3)
  })

  it('scopes by billRunId when provided', async () => {
    const env = createEnv({ testInvoiceRows: [{ id: 'test-1' }] })
    await wipeTestInvoicesCommand.execute(
      { tenantId: TENANT, organizationId: ORG, billRunId: INVOICE_ID },
      env.ctx as never,
    )
    const selectCall = env.em.execute.mock.calls[0]
    expect(selectCall[0]).toContain("metadata->>'bill_run_id' = ?")
    expect(selectCall[1]).toContain(INVOICE_ID)
  })
})

// Suppress unused-import warning — DraftInvoiceEdit is needed by the
// mock's discriminator path but not directly referenced by name in
// individual assertions.
void DraftInvoiceEdit
