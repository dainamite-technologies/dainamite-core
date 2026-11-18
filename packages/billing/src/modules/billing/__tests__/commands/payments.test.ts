jest.mock('../../lib/accountLock', () => ({
  withAccountLock: jest.fn(async (em: unknown, _s: unknown, fn: (tem: unknown) => Promise<unknown>) => fn(em)),
}))
jest.mock('../../lib/allocation', () => {
  const actual = jest.requireActual('../../lib/allocation')
  return {
    ...actual,
    allocate: jest.fn(async () => actual.emptyEffects()),
    unallocate: jest.fn(async () => actual.emptyEffects()),
    applyAccountCredit: jest.fn(async () => actual.emptyEffects()),
  }
})
jest.mock('../../lib/topupCapture', () => ({ captureTopup: jest.fn(async () => ({ status: 'captured' })) }))
jest.mock('../../events', () => ({ emitBillingEvent: jest.fn(async () => undefined) }))

import { BillingAccount, BillingInvoice, BillingPayment, BillingSettings, BillingTopup } from '../../data/entities'
import { allocate, applyAccountCredit, unallocate } from '../../lib/allocation'
import { captureTopup } from '../../lib/topupCapture'
import { emitBillingEvent } from '../../events'
import {
  allocatePaymentCommand,
  assignPaymentCommand,
  convertToTopupCommand,
  createPaymentCommand,
  ignorePaymentCommand,
  restorePaymentCommand,
  unallocateCommand,
  unassignPaymentCommand,
} from '../../commands/payments'
import { recordGatewayCapture } from '../../subscribers/payment-captured-to-paid'
import { applyCreditForAccount } from '../../subscribers/invoice-apply-credit'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PAY = '33333333-3333-4333-8333-333333333333'
const ACC = '44444444-4444-4444-8444-444444444444'
const INV = '55555555-5555-4555-8555-555555555555'
const ALLOC = '66666666-6666-4666-8666-666666666666'
const base = { tenantId: TENANT, organizationId: ORG }

type Row = Record<string, unknown>

function env(opts: { payment?: Row | null; account?: Row | null; invoice?: Row | null; allocations?: number; existingByExternalRef?: Row | null } = {}) {
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const created: Row[] = []
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === BillingPayment) return 'externalRef' in where ? (opts.existingByExternalRef ?? null) : (opts.payment ?? null)
      if (entity === BillingAccount) return opts.account ?? null
      if (entity === BillingInvoice) return opts.invoice ?? null
      if (entity === BillingSettings) return { topupTaxRate: '23' }
      if (entity === BillingTopup) return null
      return null
    }),
    execute: jest.fn(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params })
      if (sql.includes('COUNT(*)::int AS n FROM billing_allocations')) return [{ n: opts.allocations ?? 0 }]
      if (sql.includes('SELECT status, unallocated_amount')) return [{ status: 'matched', unallocated_amount: '10.0000' }]
      if (sql.includes('SELECT bill_account_id FROM billing_allocations')) return opts.allocations === -1 ? [] : [{ bill_account_id: ACC }]
      return []
    }),
    create: jest.fn((_e: unknown, data: Row) => {
      const row = { id: `new-${created.length + 1}`, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const ctx = { container: { resolve: jest.fn(() => em) }, auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } }
  return { em, ctx, executed, created }
}

const payment = (overrides: Row = {}): Row => ({
  id: PAY,
  ...base,
  amount: '100.0000',
  unallocatedAmount: '100.0000',
  currencyCode: 'PLN',
  status: 'unmatched',
  billAccountId: null,
  reference: 'x',
  ...overrides,
})
const account = (overrides: Row = {}): Row => ({
  id: ACC,
  ...base,
  currencyCode: 'PLN',
  billingMode: 'postpaid',
  ...overrides,
})

beforeEach(() => jest.clearAllMocks())

describe('payment commands', () => {
  it('manual payment with an account is matched and spends its credit', async () => {
    const e = env({ account: account() })
    await createPaymentCommand.execute(
      { ...base, receivedAt: '2026-11-20', amount: 50, currencyCode: 'pln', billAccountId: ACC },
      e.ctx as never,
    )
    expect(e.created[0]).toMatchObject({ status: 'matched', amount: '50.0000', unallocatedAmount: '50.0000', source: 'manual', billAccountId: ACC })
    expect(applyAccountCredit).toHaveBeenCalledWith(e.em, base, { id: ACC, currencyCode: 'PLN' }, { onlySources: [{ type: 'payment', id: 'new-1' }] })
    expect(emitBillingEvent).toHaveBeenCalledWith('billing.payment.created', expect.objectContaining({ source: 'manual' }))
  })

  it('manual payment without an account stays unmatched', async () => {
    const e = env()
    await createPaymentCommand.execute({ ...base, receivedAt: '2026-11-20', amount: 50, currencyCode: 'PLN' }, e.ctx as never)
    expect(e.created[0]).toMatchObject({ status: 'unmatched', matchReason: 'manual' })
    expect(applyAccountCredit).not.toHaveBeenCalled()
  })

  it('assigns an unmatched payment and applies it as credit; refuses prepaid / currency / non-unmatched', async () => {
    const ok = env({ payment: payment(), account: account() })
    await assignPaymentCommand.execute({ ...base, paymentId: PAY, billAccountId: ACC }, ok.ctx as never)
    expect(ok.executed.some((x) => x.sql.includes("status = 'matched'"))).toBe(true)
    expect(applyAccountCredit).toHaveBeenCalled()

    const prepaid = env({ payment: payment(), account: account({ billingMode: 'prepaid' }) })
    await expect(assignPaymentCommand.execute({ ...base, paymentId: PAY, billAccountId: ACC }, prepaid.ctx as never)).rejects.toMatchObject({
      body: expect.objectContaining({ code: 'billing.payment.prepaid_account' }),
    })
    const eur = env({ payment: payment({ currencyCode: 'EUR' }), account: account() })
    await expect(assignPaymentCommand.execute({ ...base, paymentId: PAY, billAccountId: ACC }, eur.ctx as never)).rejects.toMatchObject({
      body: expect.objectContaining({ code: 'billing.payment.currency_mismatch' }),
    })
    const done = env({ payment: payment({ status: 'allocated' }), account: account() })
    await expect(assignPaymentCommand.execute({ ...base, paymentId: PAY, billAccountId: ACC }, done.ctx as never)).rejects.toMatchObject({ status: 409 })
  })

  it('unassign requires no allocations', async () => {
    const busy = env({ payment: payment({ status: 'matched', billAccountId: ACC }), allocations: 1 })
    await expect(unassignPaymentCommand.execute({ ...base, paymentId: PAY }, busy.ctx as never)).rejects.toMatchObject({
      body: expect.objectContaining({ code: 'billing.payment.has_allocations' }),
    })
    const free = env({ payment: payment({ status: 'matched', billAccountId: ACC }) })
    await unassignPaymentCommand.execute({ ...base, paymentId: PAY }, free.ctx as never)
    expect(free.executed.some((x) => x.sql.includes('bill_account_id = NULL'))).toBe(true)
  })

  it('allocates each requested amount in cents through the allocation service', async () => {
    const e = env({ payment: payment({ status: 'matched', billAccountId: ACC }) })
    await allocatePaymentCommand.execute({ ...base, paymentId: PAY, allocations: [{ invoiceId: INV, amount: 12.34 }] }, e.ctx as never)
    expect(allocate).toHaveBeenCalledWith(e.em, base, {
      source: { type: 'payment', id: PAY },
      invoiceId: INV,
      amountCents: 1234,
      by: 'user',
      userId: 'user-1',
    })
    const unassigned = env({ payment: payment() })
    await expect(
      allocatePaymentCommand.execute({ ...base, paymentId: PAY, allocations: [{ invoiceId: INV, amount: 1 }] }, unassigned.ctx as never),
    ).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.payment.unassigned' }) })
  })

  it('un-allocates by allocation id (404 when unknown)', async () => {
    const e = env()
    await unallocateCommand.execute({ ...base, allocationId: ALLOC }, e.ctx as never)
    expect(unallocate).toHaveBeenCalledWith(e.em, base, { allocationId: ALLOC, userId: 'user-1' })
    const missing = env({ allocations: -1 })
    await expect(unallocateCommand.execute({ ...base, allocationId: ALLOC }, missing.ctx as never)).rejects.toMatchObject({ status: 404 })
  })

  it('ignores only unallocated payments and restores them to their previous state', async () => {
    const busy = env({ payment: payment({ status: 'matched', billAccountId: ACC }), allocations: 2 })
    await expect(ignorePaymentCommand.execute({ ...base, paymentId: PAY }, busy.ctx as never)).rejects.toMatchObject({ status: 409 })
    const ok = env({ payment: payment() })
    await ignorePaymentCommand.execute({ ...base, paymentId: PAY }, ok.ctx as never)
    expect(ok.executed.some((x) => x.sql.includes("status = 'ignored'"))).toBe(true)

    const ignored = env({ payment: payment({ status: 'ignored', billAccountId: ACC }), account: account() })
    await restorePaymentCommand.execute({ ...base, paymentId: PAY }, ignored.ctx as never)
    expect(ignored.executed.some((x) => x.params[0] === 'matched')).toBe(true)
    expect(applyAccountCredit).toHaveBeenCalled()
  })

  it('converts an unmatched payment of a prepaid account into a captured top-up', async () => {
    const e = env({ payment: payment(), account: account({ billingMode: 'prepaid' }) })
    const result = await convertToTopupCommand.execute({ ...base, paymentId: PAY, billAccountId: ACC }, e.ctx as never)
    expect(e.created[0]).toMatchObject({ providerKey: 'bank_transfer', paymentId: PAY, sourceRef: `topup-${PAY}`, amount: '100.0000' })
    expect(captureTopup).toHaveBeenCalledWith(e.em, expect.objectContaining({ taxRate: 23 }))
    expect(e.executed.some((x) => x.sql.includes("status = 'converted_to_topup'"))).toBe(true)
    expect(result.topupId).toBe('new-1')
    expect(emitBillingEvent).toHaveBeenCalledWith('billing.payment.converted_to_topup', expect.anything())

    const postpaid = env({ payment: payment(), account: account() })
    await expect(convertToTopupCommand.execute({ ...base, paymentId: PAY, billAccountId: ACC }, postpaid.ctx as never)).rejects.toMatchObject({
      body: expect.objectContaining({ code: 'billing.payment.not_prepaid' }),
    })
    const partly = env({ payment: payment({ unallocatedAmount: '40.0000' }), account: account({ billingMode: 'prepaid' }) })
    await expect(convertToTopupCommand.execute({ ...base, paymentId: PAY, billAccountId: ACC }, partly.ctx as never)).rejects.toMatchObject({
      body: expect.objectContaining({ code: 'billing.payment.not_convertible' }),
    })
  })
})

describe('gateway capture subscriber', () => {
  const invoice = (overrides: Row = {}): Row => ({
    id: INV,
    ...base,
    billAccountId: ACC,
    documentType: 'invoice',
    status: 'posted',
    testRun: false,
    number: 'INV/2026/11/0001',
    currencyCode: 'PLN',
    outstanding: '123.0000',
    ...overrides,
  })

  it('records a gateway payment allocated to the invoice', async () => {
    const e = env({ invoice: invoice() })
    expect(await recordGatewayCapture(e.em as never, { ...base, paymentId: INV, transactionId: 'tx-1', amount: 123 })).toBe('recorded')
    expect(e.created[0]).toMatchObject({ source: 'gateway', externalRef: 'tx-1', amount: '123.0000', billAccountId: ACC, status: 'matched' })
    expect(allocate).toHaveBeenCalledWith(e.em, base, expect.objectContaining({ invoiceId: INV, amountCents: 12300, by: 'gateway' }))
  })

  it('is idempotent and ignores non-billing payments', async () => {
    const dup = env({ invoice: invoice(), existingByExternalRef: { id: 'p' } })
    expect(await recordGatewayCapture(dup.em as never, { ...base, paymentId: INV, transactionId: 'tx-1' })).toBe('duplicate')
    const foreign = env({ invoice: null })
    expect(await recordGatewayCapture(foreign.em as never, { ...base, paymentId: INV })).toBe('skipped')
    expect(await recordGatewayCapture(env().em as never, { paymentId: INV })).toBe('skipped')
    expect(allocate).not.toHaveBeenCalled()
  })
})

describe('credit on post subscriber', () => {
  it('spends account credit for postpaid accounts only', async () => {
    const e = env({ account: account() })
    await applyCreditForAccount(e.em as never, { ...base, billAccountId: ACC })
    expect(applyAccountCredit).toHaveBeenCalledWith(e.em, base, { id: ACC, currencyCode: 'PLN' })
    jest.clearAllMocks()
    await applyCreditForAccount(env({ account: account({ billingMode: 'prepaid' }) }).em as never, { ...base, billAccountId: ACC })
    expect(applyAccountCredit).not.toHaveBeenCalled()
  })
})
