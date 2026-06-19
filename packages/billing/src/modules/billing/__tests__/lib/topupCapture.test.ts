import { captureTopup } from '../../lib/topupCapture'
import { __resetInvoiceStatusCacheForTests } from '../../lib/invoiceStatus'
import { createPrepaidMockEm } from '../helpers/prepaidMockEm'

const ACCOUNT = {
  id: 'acct-1',
  organizationId: 'org-1',
  tenantId: 'ten-1',
  currencyCode: 'EUR',
}

function makeDeps() {
  return {
    numberGenerator: {
      generate: jest.fn(async () => ({ number: 'FV/2026/06/0042', format: 'x', sequence: 42 })),
    },
    taxService: {
      calculateUnitAmounts: jest.fn(async (input: { amount: number }) => ({
        netAmount: input.amount,
        grossAmount: input.amount,
        taxAmount: 0,
        taxRate: 0,
      })),
    },
  }
}

function makeTopup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'topup-1',
    status: 'pending',
    amount: '100.0000',
    paymentId: 'pay-1',
    providerKey: 'stripe',
    billAccountId: 'acct-1',
    tenantId: 'ten-1',
    organizationId: 'org-1',
    ...overrides,
  }
}

beforeEach(() => {
  __resetInvoiceStatusCacheForTests()
})

describe('captureTopup', () => {
  it('credits the balance, issues a receipt, and flips the top-up to captured', async () => {
    const topup = makeTopup()
    const em = createPrepaidMockEm({
      topup,
      balance: { tenantId: 'ten-1', billAccountId: 'acct-1', balance: '0.0000' },
    })
    const result = await captureTopup(em as never, makeDeps(), {
      topup: topup as never,
      account: ACCOUNT,
      taxRate: 0,
      gatewayTransactionId: 'gw-1',
    })

    expect(result.status).toBe('captured')
    expect(result.balanceAfter).toBe('100.0000')
    expect(result.transactionId).toBeTruthy()
    expect(result.receiptInvoiceId).toBeTruthy()
    expect(result.invoiceNumber).toBe('FV/2026/06/0042')

    // The credit transaction carries the deterministic source_ref.
    expect(em.transactions).toHaveLength(1)
    expect(em.transactions[0].type).toBe('topup')
    expect(em.transactions[0].amount).toBe('100.0000')
    expect(em.transactions[0].sourceRef).toBe('topup-pay-1')

    // The top-up itself transitioned + backfilled.
    expect(topup.status).toBe('captured')
    expect((topup as Record<string, unknown>).transactionId).toBe(result.transactionId)
    expect((topup as Record<string, unknown>).receiptInvoiceId).toBe(result.receiptInvoiceId)
  })

  it('is a no-op on an already-captured top-up (idempotent re-fire)', async () => {
    const topup = makeTopup({ status: 'captured' })
    const em = createPrepaidMockEm({
      topup,
      balance: { tenantId: 'ten-1', billAccountId: 'acct-1', balance: '100.0000' },
    })
    const result = await captureTopup(em as never, makeDeps(), {
      topup: topup as never,
      account: ACCOUNT,
      taxRate: 0,
    })
    expect(result.status).toBe('already_captured')
    expect(em.transactions).toHaveLength(0) // no second credit
  })

  it('does not double-credit OR issue a second receipt when the source_ref exists', async () => {
    // Simulates an at-least-once / concurrent re-fire that raced past the stale
    // status check: the credit dedups AND no second fiscal receipt is minted.
    const topup = makeTopup({ transactionId: 'txn-prior', receiptInvoiceId: 'inv-prior' })
    const em = createPrepaidMockEm({
      topup,
      balance: { tenantId: 'ten-1', billAccountId: 'acct-1', balance: '100.0000' },
    })
    em.transactions.push({
      id: 'txn-prior',
      type: 'topup',
      amount: '100.0000',
      balanceAfter: '100.0000',
      sourceRef: 'topup-pay-1',
      billAccountId: 'acct-1',
      createdAt: new Date('2026-06-10'),
    })
    const deps = makeDeps()
    const result = await captureTopup(em as never, deps, {
      topup: topup as never,
      account: ACCOUNT,
      taxRate: 0,
    })
    expect(result.status).toBe('already_captured')
    expect(result.balanceAfter).toBe('100.0000') // unchanged — dedup hit
    expect(result.receiptInvoiceId).toBe('inv-prior') // returns the existing receipt
    expect(em.transactions).toHaveLength(1) // no new credit transaction
    // No second fiscal document: the number generator was never called.
    expect(deps.numberGenerator.generate).not.toHaveBeenCalled()
  })
})
