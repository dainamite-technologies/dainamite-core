/**
 * Unit tests for the billing invoice commands (Spec 0 — billing-owned
 * `billing_invoices`): post (number claimed at post, snapshots, refusals),
 * draft line edit / add / remove (audit + totals), and the test wipe.
 *
 * The mock EM models the subset the commands touch, keyed by entity class:
 * findOne / find / create / persist / flush / remove / execute /
 * transactional / fork.
 */

import {
  addDraftLineCommand,
  buildBuyerSnapshot,
  editDraftLineCommand,
  postInvoiceCommand,
  removeDraftLineCommand,
  wipeTestInvoicesCommand,
} from '../../commands/invoices'
import {
  BillingAccount,
  BillingDraftInvoiceEdit,
  BillingInvoice,
  BillingInvoiceLine,
  BillingSettings,
} from '../../data/entities'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const INVOICE_ID = '33333333-3333-4333-8333-333333333333'
const LINE_ID = '44444444-4444-4444-8444-444444444444'
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555'

type Row = Record<string, unknown>

function makeInvoice(overrides: Row = {}): Row {
  return {
    id: INVOICE_ID,
    tenantId: TENANT,
    organizationId: ORG,
    billAccountId: ACCOUNT_ID,
    documentType: 'invoice',
    number: 'DRAFT-ABCDEF12',
    series: null,
    status: 'draft',
    testRun: false,
    currencyCode: 'EUR',
    subtotalNet: '100.0000',
    taxTotal: '0.0000',
    totalGross: '100.0000',
    paidTotal: '0',
    outstanding: '100.0000',
    billDate: new Date('2026-12-01T00:00:00Z'),
    periodStart: new Date('2026-12-01T00:00:00Z'),
    periodEnd: new Date('2026-12-31T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

function makeLine(overrides: Row = {}): Row {
  return {
    id: LINE_ID,
    invoiceId: INVOICE_ID,
    tenantId: TENANT,
    organizationId: ORG,
    lineNumber: 1,
    billingItemId: null,
    billingType: 'recurring',
    description: 'MRC',
    quantity: '1.0000',
    unitPriceNet: '100.0000',
    taxRate: '0',
    netAmount: '100.0000',
    taxAmount: '0.0000',
    grossAmount: '100.0000',
    metadata: null,
    deletedAt: null,
    ...overrides,
  }
}

const account = {
  id: ACCOUNT_ID,
  tenantId: TENANT,
  organizationId: ORG,
  name: 'Jan Kowalski',
  customerId: 'cust-1',
  customerKind: 'person',
  taxId: null,
  invoiceEmail: 'jan@example.test',
  invoiceLanguage: 'pl',
  invoiceAddress: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' },
  creditLimit: '0',
  currencyCode: 'EUR',
  billingMode: 'postpaid',
}

function createEnv(options: {
  invoice?: Row | null
  line?: Row | null
  lines?: Row[]
  testInvoiceIds?: string[]
  seq?: number
  claimThrows?: Error
} = {}) {
  const persisted: unknown[] = []
  const removed: unknown[] = []
  const executed: Array<{ sql: string; params: unknown[] }> = []
  let created = 0
  const lines = options.lines ?? (options.line ? [options.line] : [])

  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === BillingInvoice) return options.invoice ?? null
      if (entity === BillingInvoiceLine) return options.line ?? null
      if (entity === BillingAccount) return account
      if (entity === BillingSettings) return { id: 'settings-1', numberMasks: null }
      return null
    }),
    find: jest.fn(async (entity: unknown) => (entity === BillingInvoiceLine ? lines : [])),
    create: jest.fn((entity: unknown, data: Row) => {
      created += 1
      const prefix = entity === BillingDraftInvoiceEdit ? 'audit' : entity === BillingInvoiceLine ? 'new-line' : 'gen'
      return { ...data, id: `${prefix}-${created}` }
    }),
    persist: jest.fn((entity: unknown) => {
      persisted.push(entity)
    }),
    flush: jest.fn(async () => undefined),
    remove: jest.fn((entity: unknown) => {
      removed.push(entity)
    }),
    execute: jest.fn(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params })
      if (sql.includes('billing_document_sequences')) {
        if (options.claimThrows) throw options.claimThrows
        return [{ seq: options.seq ?? 1 }]
      }
      if (sql.includes('SUM(outstanding)')) return [{ total: '0' }]
      if (sql.startsWith('SELECT id FROM billing_invoices')) return (options.testInvoiceIds ?? []).map((id) => ({ id }))
      return []
    }),
    transactional: jest.fn(),
    fork: jest.fn(),
  }
  // Nested transactions / forks reuse the same mock EM.
  em.transactional.mockImplementation(async (fn: (tem: unknown) => Promise<unknown>) => fn(em))
  em.fork.mockReturnValue(em)

  const ctx = {
    container: { resolve: jest.fn((name: string) => (name === 'em' ? em : null)) },
    auth: { sub: '99999999-9999-4999-8999-999999999999', tenantId: TENANT, orgId: ORG },
  }
  return { em, ctx, persisted, removed, executed }
}

const baseInput = { tenantId: TENANT, organizationId: ORG, invoiceId: INVOICE_ID }

describe('postInvoiceCommand', () => {
  it('claims the series number at post and freezes the buyer snapshot', async () => {
    const invoice = makeInvoice()
    const env = createEnv({ invoice, lines: [makeLine()], seq: 7 })
    const result = await postInvoiceCommand.execute(baseInput, env.ctx as never)

    expect(result).toMatchObject({ status: 'posted', lineCount: 1 })
    expect(result.invoiceNumber).toMatch(/^INV\/\d{4}\/\d{2}\/0007$/)
    expect(invoice).toMatchObject({
      status: 'posted',
      series: 'invoice',
      number: result.invoiceNumber,
      outstanding: '100.0000',
      paidTotal: '0',
    })
    expect(invoice.issueDate).toBeInstanceOf(Date)
    expect(invoice.buyerSnapshot).toMatchObject({ name: 'Jan Kowalski', customer_kind: 'person', invoice_language: 'pl' })
    const claim = env.executed.find((e) => e.sql.includes('billing_document_sequences'))
    expect(claim?.params.slice(0, 3)).toEqual([TENANT, ORG, 'invoice'])
  })

  it('refuses non-draft invoices with 409 not_draft', async () => {
    const env = createEnv({ invoice: makeInvoice({ status: 'posted' }) })
    await expect(postInvoiceCommand.execute(baseInput, env.ctx as never)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'billing.invoice.not_draft' }),
    })
  })

  it('refuses test-run drafts with 409 test_run and never claims a number', async () => {
    const env = createEnv({ invoice: makeInvoice({ testRun: true, number: 'TEST-1' }) })
    await expect(postInvoiceCommand.execute(baseInput, env.ctx as never)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'billing.invoice.test_run' }),
    })
    expect(env.executed.some((e) => e.sql.includes('billing_document_sequences'))).toBe(false)
  })

  it('leaves the draft untouched when the number claim fails (transaction rolls back)', async () => {
    const invoice = makeInvoice()
    const env = createEnv({ invoice, claimThrows: new Error('db down') })
    await expect(postInvoiceCommand.execute(baseInput, env.ctx as never)).rejects.toThrow('db down')
    expect(invoice).toMatchObject({ status: 'draft', number: 'DRAFT-ABCDEF12', series: null })
  })

  it('throws 404 when the invoice does not exist for this scope', async () => {
    const env = createEnv({ invoice: null })
    await expect(postInvoiceCommand.execute(baseInput, env.ctx as never)).rejects.toMatchObject({ status: 404 })
  })

  it('builds a buyer snapshot from the account', () => {
    expect(buildBuyerSnapshot(account as never)).toEqual({
      bill_account_id: ACCOUNT_ID,
      name: 'Jan Kowalski',
      customer_id: 'cust-1',
      customer_kind: 'person',
      tax_id: null,
      invoice_email: 'jan@example.test',
      invoice_language: 'pl',
      invoice_address: account.invoiceAddress,
    })
  })
})

describe('editDraftLineCommand', () => {
  const input = { ...baseInput, invoiceLineId: LINE_ID }

  it('refuses non-draft invoices', async () => {
    const env = createEnv({ invoice: makeInvoice({ status: 'posted' }), line: makeLine() })
    await expect(
      editDraftLineCommand.execute({ ...input, changes: { description: 'x' } }, env.ctx as never),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('recomputes the line from unit price × quantity and the invoice totals', async () => {
    const invoice = makeInvoice()
    const line = makeLine()
    const env = createEnv({ invoice, line })
    await editDraftLineCommand.execute({ ...input, changes: { quantity: 3, description: 'MRC ×3' } }, env.ctx as never)
    expect(line).toMatchObject({ description: 'MRC ×3', quantity: '3.0000', netAmount: '300.0000', grossAmount: '300.0000' })
    expect(invoice).toMatchObject({ subtotalNet: '300.0000', totalGross: '300.0000', outstanding: '300.0000' })
  })

  it('honours an explicit totalNetAmount override and writes an audit row', async () => {
    const line = makeLine()
    const env = createEnv({ invoice: makeInvoice(), line })
    const result = await editDraftLineCommand.execute(
      { ...input, changes: { totalNetAmount: 42.5 } },
      env.ctx as never,
    )
    expect(line.netAmount).toBe('42.5000')
    const audit = env.persisted.find((p) => (p as Row).action === 'line_edited') as Row
    expect(audit).toMatchObject({ id: result.auditId, invoiceId: INVOICE_ID, invoiceLineId: LINE_ID })
    expect((audit.beforeJson as Row).netAmount).toBe('100.0000')
    expect((audit.afterJson as Row).netAmount).toBe('42.5000')
  })

  it('returns 404 when the line is not on the invoice', async () => {
    const env = createEnv({ invoice: makeInvoice(), line: null })
    await expect(
      editDraftLineCommand.execute({ ...input, changes: { description: 'x' } }, env.ctx as never),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('addDraftLineCommand', () => {
  it('appends a manual line after the highest line number and audits it', async () => {
    const env = createEnv({ invoice: makeInvoice(), lines: [makeLine({ lineNumber: 4 })] })
    const result = await addDraftLineCommand.execute(
      { ...baseInput, description: 'Setup fee', quantity: 2, unitPriceNet: 25 },
      env.ctx as never,
    )
    const line = env.persisted.find((p) => (p as Row).id === result.invoiceLineId) as Row
    expect(line).toMatchObject({ lineNumber: 5, billingType: 'manual', netAmount: '50.0000', grossAmount: '50.0000' })
    expect(env.persisted.some((p) => (p as Row).action === 'line_added')).toBe(true)
  })

  it('refuses non-draft invoices', async () => {
    const env = createEnv({ invoice: makeInvoice({ status: 'paid' }) })
    await expect(
      addDraftLineCommand.execute({ ...baseInput, description: 'x', quantity: 1, unitPriceNet: 1 }, env.ctx as never),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('removeDraftLineCommand', () => {
  it('removes the line and writes a line_removed audit with the before snapshot', async () => {
    const line = makeLine()
    const env = createEnv({ invoice: makeInvoice(), line })
    await removeDraftLineCommand.execute({ ...baseInput, invoiceLineId: LINE_ID }, env.ctx as never)
    expect(env.removed).toContain(line)
    const audit = env.persisted.find((p) => (p as Row).action === 'line_removed') as Row
    expect(audit.afterJson).toBeNull()
    expect((audit.beforeJson as Row).id).toBe(LINE_ID)
  })
})

describe('wipeTestInvoicesCommand', () => {
  it('returns 0 when no test invoices match', async () => {
    const env = createEnv({ testInvoiceIds: [] })
    expect(await wipeTestInvoicesCommand.execute({ tenantId: TENANT, organizationId: ORG }, env.ctx as never)).toEqual({
      invoicesRemoved: 0,
    })
  })

  it('deletes lines, then invoices, from the billing tables only', async () => {
    const env = createEnv({ testInvoiceIds: ['a', 'b'] })
    const res = await wipeTestInvoicesCommand.execute({ tenantId: TENANT, organizationId: ORG }, env.ctx as never)
    expect(res.invoicesRemoved).toBe(2)
    const deletes = env.executed.filter((e) => e.sql.startsWith('DELETE'))
    expect(deletes.map((d) => d.sql.split(' ')[2])).toEqual(['billing_invoice_lines', 'billing_invoices'])
    expect(env.executed.some((e) => e.sql.includes('sales_invoices'))).toBe(false)
  })

  it('scopes by billRunId when provided', async () => {
    const runId = '66666666-6666-4666-8666-666666666666'
    const env = createEnv({ testInvoiceIds: [] })
    await wipeTestInvoicesCommand.execute({ tenantId: TENANT, organizationId: ORG, billRunId: runId }, env.ctx as never)
    const select = env.executed[0]
    expect(select.sql).toContain('bill_run_id = ?')
    expect(select.params).toContain(runId)
  })
})
