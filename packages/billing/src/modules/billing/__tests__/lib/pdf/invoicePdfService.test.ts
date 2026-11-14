jest.mock('../../../lib/pdf/invoiceTemplate', () => ({
  renderInvoicePdf: jest.fn(async () => new Uint8Array([37, 80, 68, 70])),
}))
jest.mock('../../../lib/pdf/attachmentStore', () => ({
  storeAttachment: jest.fn(async () => 'att-new'),
  readAttachment: jest.fn(async () => null),
  attachmentIdFromUrl: jest.requireActual('../../../lib/pdf/attachmentStore').attachmentIdFromUrl,
}))

import { renderInvoicePdf } from '../../../lib/pdf/invoiceTemplate'
import { readAttachment, storeAttachment } from '../../../lib/pdf/attachmentStore'
import { freezeInvoicePdf, getInvoicePdf, pdfFileName } from '../../../lib/pdf/invoicePdf'
import { BillingAccount, BillingInvoice, BillingInvoiceLine, BillingSettings } from '../../../data/entities'
import type { InvoiceDocumentModel } from '../../../lib/pdf/invoiceModel'

const scope = { tenantId: 't-1', organizationId: 'o-1' }
const loadTranslator = async () => (_key: string, fallback: string) => fallback

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    ...scope,
    billAccountId: 'acc-1',
    number: 'INV/2026/11/0001',
    documentType: 'invoice',
    status: 'posted',
    testRun: false,
    issueDate: new Date('2026-11-14T00:00:00Z'),
    dueDate: new Date('2026-11-28T00:00:00Z'),
    currencyCode: 'PLN',
    subtotalNet: '100.0000',
    taxTotal: '23.0000',
    totalGross: '123.0000',
    pdfAttachmentId: null,
    sellerSnapshot: { legal_name: 'Frozen Seller', tax_id: 'PL-FROZEN', iban: 'PL61109010140000071219812874', logo_attachment_id: null },
    buyerSnapshot: { name: 'Frozen Buyer', invoice_language: 'pl' },
    ...overrides,
  } as unknown as BillingInvoice
}

function makeEm() {
  return {
    find: jest.fn(async (entity: unknown) =>
      entity === BillingInvoiceLine
        ? [
            {
              description: 'Plan',
              quantity: '1',
              unitPriceNet: '100',
              taxRate: '23',
              netAmount: '100',
              taxAmount: '23',
              grossAmount: '123',
            },
          ]
        : [],
    ),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === BillingSettings) return { organizationId: 'o-1', legalName: 'Live Seller', taxId: 'PL-LIVE' }
      if (entity === BillingAccount) return { id: 'acc-1', name: 'Live Buyer', invoiceLanguage: 'en', invoiceEmail: 'x@y.z' }
      return null
    }),
    execute: jest.fn(async (): Promise<Array<{ logo_url: string | null }>> => [{ logo_url: null }]),
    nativeUpdate: jest.fn(async () => 1),
  }
}

const lastModel = () => (renderInvoicePdf as jest.Mock).mock.calls.at(-1)?.[0] as InvoiceDocumentModel

beforeEach(() => jest.clearAllMocks())

describe('invoice PDF service', () => {
  it('renders drafts live with live parties and never stores them', async () => {
    const em = makeEm()
    const draft = invoiceRow({ status: 'draft', number: 'DRAFT-1A2B3C4D', sellerSnapshot: null, buyerSnapshot: null })
    const pdf = await getInvoicePdf(em as never, draft, { loadTranslator })
    expect(pdf).toMatchObject({ fileName: 'DRAFT-1A2B3C4D.pdf', frozen: false })
    expect(lastModel().seller.lines[0]).toBe('Live Seller')
    expect(lastModel().buyer.lines[0]).toBe('Live Buyer')
    expect(lastModel().watermark).toBe('DRAFT')
    expect(storeAttachment).not.toHaveBeenCalled()
  })

  it('serves the frozen attachment of a posted document without re-rendering', async () => {
    ;(readAttachment as jest.Mock).mockResolvedValueOnce({ bytes: new Uint8Array([1, 2]), mimeType: 'application/pdf', fileName: 'x.pdf' })
    const pdf = await getInvoicePdf(makeEm() as never, invoiceRow({ pdfAttachmentId: 'att-1' }), { loadTranslator })
    expect(pdf).toMatchObject({ frozen: true, fileName: 'INV-2026-11-0001.pdf' })
    expect(Array.from(pdf.bytes)).toEqual([1, 2])
    expect(renderInvoicePdf).not.toHaveBeenCalled()
  })

  it('freezes a posted document lazily on first request, from the frozen snapshots', async () => {
    const em = makeEm()
    const invoice = invoiceRow()
    const pdf = await getInvoicePdf(em as never, invoice, { loadTranslator })
    expect(pdf.frozen).toBe(true)
    expect(storeAttachment).toHaveBeenCalledWith(em, scope, expect.objectContaining({
      entityId: 'billing:billing_invoice',
      recordId: 'inv-1',
      mimeType: 'application/pdf',
      fileName: 'INV-2026-11-0001.pdf',
    }))
    // Conditional claim: only sets the column when still empty.
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      BillingInvoice,
      expect.objectContaining({ id: 'inv-1', pdfAttachmentId: null }),
      { pdfAttachmentId: 'att-new' },
    )
    expect(invoice.pdfAttachmentId).toBe('att-new')
    expect(lastModel().seller.lines[0]).toBe('Frozen Seller')
    expect(lastModel().buyer.lines[0]).toBe('Frozen Buyer')
    expect(lastModel().watermark).toBeNull()
  })

  it('is idempotent and refuses to freeze drafts or test documents', async () => {
    await expect(freezeInvoicePdf(makeEm() as never, invoiceRow({ pdfAttachmentId: 'att-1' }))).resolves.toEqual({
      attachmentId: 'att-1',
      bytes: null,
    })
    expect(storeAttachment).not.toHaveBeenCalled()
    await expect(freezeInvoicePdf(makeEm() as never, invoiceRow({ status: 'draft' }))).rejects.toThrow()
    await expect(freezeInvoicePdf(makeEm() as never, invoiceRow({ testRun: true }))).rejects.toThrow()
  })

  it('falls back to a fresh render when the stored file is unreadable', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const pdf = await getInvoicePdf(makeEm() as never, invoiceRow({ pdfAttachmentId: 'att-lost' }), { loadTranslator })
    expect(pdf.frozen).toBe(true)
    expect(renderInvoicePdf).toHaveBeenCalledTimes(1)
    expect(storeAttachment).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('uses the organization logo only when it is one of our attachments', async () => {
    const em = makeEm()
    em.execute.mockResolvedValueOnce([{ logo_url: '/api/attachments/file/12345678-1234-4234-8234-123456789012' }])
    ;(readAttachment as jest.Mock).mockResolvedValueOnce({ bytes: new Uint8Array([9]), mimeType: 'image/png', fileName: 'l.png' })
    await getInvoicePdf(em as never, invoiceRow({ status: 'draft' }), { loadTranslator })
    expect(readAttachment).toHaveBeenCalledWith(em, scope, '12345678-1234-4234-8234-123456789012')
    expect((renderInvoicePdf as jest.Mock).mock.calls[0][1]).toEqual({ logo: { bytes: new Uint8Array([9]), mimeType: 'image/png' } })
  })

  it('builds safe file names from document numbers', () => {
    expect(pdfFileName({ number: 'INV/2026/11/0001' })).toBe('INV-2026-11-0001.pdf')
    expect(pdfFileName({ number: 'FV 1/"x"' })).toBe('FV-1-x-.pdf')
  })
})
