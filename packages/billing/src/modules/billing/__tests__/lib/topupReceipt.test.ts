import { createTopupReceipt, type TopupReceiptDeps } from '../../lib/topupReceipt'
import { __resetInvoiceStatusCacheForTests } from '../../lib/invoiceStatus'
import { createPrepaidMockEm } from '../helpers/prepaidMockEm'

const ACCOUNT = {
  id: 'acct-1',
  organizationId: 'org-1',
  tenantId: 'ten-1',
  currencyCode: 'EUR',
}

function makeDeps(taxRateOut: number | null): TopupReceiptDeps {
  return {
    numberGenerator: {
      generate: jest.fn(async () => ({
        number: 'FV/2026/06/0042',
        format: 'FV/{yyyy}/{mm}/{seq:4}',
        sequence: 42,
      })),
    },
    taxService: {
      calculateUnitAmounts: jest.fn(async (input: { amount: number; taxRate?: number | string | null }) => {
        const rate = typeof input.taxRate === 'number' ? input.taxRate : Number(input.taxRate ?? 0)
        const gross = input.amount
        const net = rate > 0 ? gross / (1 + rate / 100) : gross
        return {
          netAmount: Math.round(net * 10000) / 10000,
          grossAmount: Math.round(gross * 10000) / 10000,
          taxAmount: Math.round((gross - net) * 10000) / 10000,
          taxRate: taxRateOut,
        }
      }),
    },
  }
}

beforeEach(() => {
  __resetInvoiceStatusCacheForTests()
})

describe('createTopupReceipt — VAT at top-up (amount is gross)', () => {
  it('splits 100 gross @ 23% into net + VAT and posts paid', async () => {
    const em = createPrepaidMockEm()
    const deps = makeDeps(23)
    const receipt = await createTopupReceipt(em as never, deps, {
      account: ACCOUNT,
      topupId: 'topup-1',
      paymentId: 'pay-1',
      amount: '100.0000',
      taxRate: 23,
    })

    expect(receipt.invoiceNumber).toBe('FV/2026/06/0042')
    expect(receipt.grossAmount).toBe('100.0000')
    expect(receipt.netAmount).toBe('81.3008')
    expect(receipt.taxAmount).toBe('18.6992')
    expect(receipt.taxRate).toBe(23)

    // The invoice was persisted as paid with a single top-up line.
    const invoice = em.persisted.find((e) => (e as { status?: string }).status === 'paid') as Record<
      string,
      unknown
    >
    expect(invoice).toBeTruthy()
    expect(invoice.paidTotalAmount).toBe('100.0000')
    expect(invoice.outstandingAmount).toBe('0')
    expect((invoice.metadata as Record<string, unknown>).kind).toBe('prepaid_topup')
  })

  it('0% VAT → net == gross, tax 0', async () => {
    const em = createPrepaidMockEm()
    const deps = makeDeps(null)
    const receipt = await createTopupReceipt(em as never, deps, {
      account: ACCOUNT,
      topupId: 'topup-2',
      paymentId: 'pay-2',
      amount: '50.0000',
      taxRate: 0,
    })
    expect(receipt.netAmount).toBe('50.0000')
    expect(receipt.grossAmount).toBe('50.0000')
    expect(receipt.taxAmount).toBe('0.0000')
  })
})
