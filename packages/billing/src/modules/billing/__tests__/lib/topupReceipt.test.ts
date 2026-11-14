import { createTopupReceipt } from '../../lib/topupReceipt'
import { createPrepaidMockEm } from '../helpers/prepaidMockEm'

const ACCOUNT = {
  id: 'acct-1',
  organizationId: 'org-1',
  tenantId: 'ten-1',
  currencyCode: 'EUR',
}

const RECEIPT_NUMBER = /^RC\/\d{4}\/\d{2}\/0042$/

describe('createTopupReceipt — VAT at top-up (amount is gross)', () => {
  it('splits 100 gross @ 23% into net + VAT and issues a paid receipt document', async () => {
    const em = createPrepaidMockEm()
    const receipt = await createTopupReceipt(em as never, {
      account: ACCOUNT,
      topupId: 'topup-1',
      paymentId: 'pay-1',
      amount: '100.0000',
      taxRate: 23,
    })

    expect(receipt.invoiceNumber).toMatch(RECEIPT_NUMBER)
    expect(receipt).toMatchObject({ grossAmount: '100.0000', netAmount: '81.3000', taxAmount: '18.7000', taxRate: 23 })
    expect(em.sequenceClaims).toEqual(['receipt'])

    const doc = em.persisted.find((e) => (e as { documentType?: string }).documentType === 'receipt') as Record<string, unknown>
    expect(doc).toMatchObject({
      status: 'paid',
      series: 'receipt',
      topupId: 'topup-1',
      billAccountId: 'acct-1',
      paidTotal: '100.0000',
      outstanding: '0',
      totalGross: '100.0000',
    })
    const line = em.persisted.find((e) => (e as { billingType?: string }).billingType === 'receipt') as Record<string, unknown>
    expect(line).toMatchObject({ invoiceId: doc.id, taxRate: '23.0000', netAmount: '81.3000', taxAmount: '18.7000' })
  })

  it('0% VAT → net == gross, tax 0', async () => {
    const em = createPrepaidMockEm()
    const receipt = await createTopupReceipt(em as never, {
      account: ACCOUNT,
      topupId: 'topup-2',
      paymentId: 'pay-2',
      amount: '50.0000',
      taxRate: 0,
    })
    expect(receipt).toMatchObject({ netAmount: '50.0000', grossAmount: '50.0000', taxAmount: '0.0000', taxRate: 0 })
  })
})
