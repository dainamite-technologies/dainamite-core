import { createMemoCommand, deleteDraftMemoCommand } from '../../commands/memos'
import { BillingInvoice, BillingInvoiceLine, BillingSettings } from '../../data/entities'
import { canCorrect, displaySign, isMemo, isReceivable, seriesFor } from '../../lib/documentTypes'
import { creditFits, creditHeadroomCents } from '../../lib/memoGuards'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ORIGINAL = '33333333-3333-4333-8333-333333333333'
const LINE_A = '44444444-4444-4444-8444-444444444444'
const LINE_B = '55555555-5555-4555-8555-555555555555'
const base = { tenantId: TENANT, organizationId: ORG }

type Row = Record<string, unknown>

function original(overrides: Row = {}): Row {
  return {
    id: ORIGINAL,
    ...base,
    billAccountId: 'acc-1',
    documentType: 'invoice',
    status: 'posted',
    testRun: false,
    number: 'INV/2026/11/0001',
    issueDate: new Date('2026-11-14T00:00:00Z'),
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-11-30T00:00:00Z'),
    currencyCode: 'PLN',
    totalGross: '146.0000',
    ...overrides,
  }
}

const lines: Row[] = [
  { id: LINE_A, description: 'Internet', quantity: '1.0000', unitPriceNet: '100.0000', taxRate: '23', billingType: 'recurring', servicePeriodStart: null, servicePeriodEnd: null },
  { id: LINE_B, description: 'Router', quantity: '2.0000', unitPriceNet: '10.0000', taxRate: '8', billingType: 'one_time', servicePeriodStart: null, servicePeriodEnd: null },
]

function env(opts: { original?: Row | null; corrections?: Array<{ document_type: string; gross: string }>; target?: Row | null } = {}) {
  const created: Array<{ entity: unknown; data: Row }> = []
  const executed: string[] = []
  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === BillingInvoice) return opts.target !== undefined ? opts.target : opts.original === undefined ? original() : opts.original
      if (entity === BillingSettings) return { defaultTaxRate: '5' }
      return null
    }),
    find: jest.fn(async (entity: unknown) => (entity === BillingInvoiceLine ? lines : [])),
    execute: jest.fn(async (sql: string) => {
      executed.push(sql)
      if (sql.includes('SUM(total_gross)')) return opts.corrections ?? []
      return []
    }),
    create: jest.fn((entity: unknown, data: Row) => {
      const row = { id: `new-${created.length + 1}`, ...data }
      created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(),
    fork: jest.fn(),
  }
  em.transactional.mockImplementation(async (fn: (tem: unknown) => Promise<unknown>) => fn(em))
  em.fork.mockReturnValue(em)
  const ctx = { container: { resolve: jest.fn(() => em) }, auth: { sub: 'u', tenantId: TENANT, orgId: ORG } }
  return { em, ctx, created, executed }
}

const memoOf = (e: ReturnType<typeof env>) => e.created.find((c) => c.entity === BillingInvoice)!.data
const linesOf = (e: ReturnType<typeof env>) => e.created.filter((c) => c.entity === BillingInvoiceLine).map((c) => c.data)

describe('createMemoCommand', () => {
  it('full credit copies every original line with its own VAT rate and snapshots the original', async () => {
    const e = env()
    const result = await createMemoCommand.execute({ ...base, invoiceId: ORIGINAL, type: 'credit_memo', reason: 'Wrong price' }, e.ctx as never)
    expect(result.number).toMatch(/^DRAFT-/)
    expect(memoOf(e)).toMatchObject({
      documentType: 'credit_memo',
      status: 'draft',
      correctsInvoiceId: ORIGINAL,
      correctsInvoiceNumber: 'INV/2026/11/0001',
      correctionReason: 'Wrong price',
      billAccountId: 'acc-1',
      currencyCode: 'PLN',
      subtotalNet: '120.0000',
      taxTotal: '24.6000',
      totalGross: '144.6000',
    })
    expect(linesOf(e).map((l) => [l.correctsLineId, l.taxRate, l.grossAmount])).toEqual([
      [LINE_A, '23', '123.0000'],
      [LINE_B, '8', '21.6000'],
    ])
  })

  it('partial credit: copied lines keep the original rate even if another is sent; new lines take the org default', async () => {
    const e = env()
    await createMemoCommand.execute(
      {
        ...base,
        invoiceId: ORIGINAL,
        type: 'credit_memo',
        reason: 'Goodwill',
        lines: [
          { correctsLineId: LINE_A, description: 'Internet (3 days)', quantity: 1, unitPriceNet: 10, taxRate: 0 },
          { description: 'Goodwill', quantity: 1, unitPriceNet: 5 },
        ],
      },
      e.ctx as never,
    )
    expect(linesOf(e).map((l) => [l.correctsLineId, l.taxRate, l.netAmount])).toEqual([
      [LINE_A, '23', '10.0000'],
      [null, '5', '5.0000'],
    ])
  })

  it('debit memo without lines starts empty', async () => {
    const e = env()
    await createMemoCommand.execute({ ...base, invoiceId: ORIGINAL, type: 'debit_memo', reason: 'Missed fee' }, e.ctx as never)
    expect(memoOf(e)).toMatchObject({ documentType: 'debit_memo', totalGross: '0.0000' })
    expect(linesOf(e)).toHaveLength(0)
  })

  it.each([
    [{ status: 'draft' }, 'credit_memo'],
    [{ testRun: true }, 'credit_memo'],
    [{ documentType: 'credit_memo' }, 'credit_memo'],
    [{ documentType: 'receipt', status: 'paid' }, 'debit_memo'],
    [{ status: 'credited' }, 'credit_memo'],
  ])('refuses originals %j for %s', async (overrides, type) => {
    const e = env({ original: original(overrides) })
    await expect(
      createMemoCommand.execute({ ...base, invoiceId: ORIGINAL, type: type as 'credit_memo', reason: 'x' }, e.ctx as never),
    ).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'billing.memo.invalid_original' }) })
  })

  it('allows a debit memo on a fully credited invoice', async () => {
    const e = env({ original: original({ status: 'credited' }) })
    await expect(
      createMemoCommand.execute({ ...base, invoiceId: ORIGINAL, type: 'debit_memo', reason: 'Re-bill' }, e.ctx as never),
    ).resolves.toMatchObject({ documentType: 'debit_memo' })
  })

  it('requires a reason and rejects lines of another invoice', async () => {
    const e = env()
    await expect(createMemoCommand.execute({ ...base, invoiceId: ORIGINAL, type: 'credit_memo', reason: '  ' }, e.ctx as never)).rejects.toThrow()
    await expect(
      createMemoCommand.execute(
        {
          ...base,
          invoiceId: ORIGINAL,
          type: 'credit_memo',
          reason: 'x',
          lines: [{ correctsLineId: '99999999-9999-4999-8999-999999999999', description: 'x', quantity: 1, unitPriceNet: 1 }],
        },
        e.ctx as never,
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.memo.invalid_line' }) })
  })

  it('refuses a credit above what is left to credit (early guard)', async () => {
    const e = env({ corrections: [{ document_type: 'credit_memo', gross: '100.0000' }] })
    await expect(
      createMemoCommand.execute({ ...base, invoiceId: ORIGINAL, type: 'credit_memo', reason: 'Full' }, e.ctx as never),
    ).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.memo.exceeds_invoice' }) })
  })
})

describe('deleteDraftMemoCommand', () => {
  it('deletes a draft memo with its lines', async () => {
    const e = env({ target: { id: 'm-1', ...base, status: 'draft', documentType: 'credit_memo' } })
    await expect(deleteDraftMemoCommand.execute({ ...base, invoiceId: '66666666-6666-4666-8666-666666666666' }, e.ctx as never)).resolves.toEqual({ deleted: true })
    expect(e.executed.filter((sql) => sql.startsWith('DELETE'))).toHaveLength(2)
  })

  it('never deletes posted memos or invoice drafts', async () => {
    for (const target of [
      { id: 'm-1', ...base, status: 'posted', documentType: 'credit_memo' },
      { id: 'i-1', ...base, status: 'draft', documentType: 'invoice' },
    ]) {
      const e = env({ target })
      await expect(deleteDraftMemoCommand.execute({ ...base, invoiceId: '66666666-6666-4666-8666-666666666666' }, e.ctx as never)).rejects.toMatchObject({
        body: expect.objectContaining({ code: 'billing.memo.not_draft' }),
      })
    }
  })
})

describe('document type helpers and credit guard', () => {
  it('classifies document types', () => {
    expect(seriesFor('credit_memo')).toBe('credit_memo')
    expect(seriesFor('debit_memo')).toBe('invoice')
    expect(seriesFor('receipt')).toBe('receipt')
    expect(isReceivable('debit_memo')).toBe(true)
    expect(isReceivable('credit_memo')).toBe(false)
    expect(isMemo('credit_memo')).toBe(true)
    expect(displaySign('credit_memo')).toBe(-1)
    expect(canCorrect({ documentType: 'invoice', status: 'paid', testRun: false }, 'credit_memo')).toBe(true)
  })

  it('computes the credit headroom including debit memos', () => {
    expect(creditHeadroomCents(10000, { creditCents: 3000, debitCents: 2000 })).toBe(9000)
    expect(creditFits(10000, { creditCents: 3000, debitCents: 2000 }, 9000)).toBe(true)
    expect(creditFits(10000, { creditCents: 3000, debitCents: 2000 }, 9001)).toBe(false)
  })
})
