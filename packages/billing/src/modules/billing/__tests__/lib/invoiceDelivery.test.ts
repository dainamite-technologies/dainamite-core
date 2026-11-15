jest.mock('../../lib/pdf/invoicePdf', () => ({
  getInvoicePdf: jest.fn(async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), fileName: 'INV-2026-11-0001.pdf', frozen: true })),
  loadDocumentTranslator: jest.fn(),
}))
jest.mock('../../events', () => ({ emitBillingEvent: jest.fn(async () => undefined) }))

import { emitBillingEvent } from '../../events'
import { BillingAccount, BillingInvoice } from '../../data/entities'
import {
  buildInvoiceEmail,
  hasSuccessfulDelivery,
  isDeliverableEmail,
  sendInvoice,
} from '../../lib/invoiceDelivery'
import { autoSendInvoice } from '../../subscribers/invoice-auto-send'

const scope = { tenantId: 't-1', organizationId: 'o-1' }
const loadTranslator = async () => (_key: string, fallback: string) => fallback
const now = () => new Date('2026-11-14T12:00:00Z')

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    ...scope,
    billAccountId: 'acc-1',
    number: 'INV/2026/11/0001',
    documentType: 'invoice',
    status: 'posted',
    testRun: false,
    totalGross: '123.0000',
    currencyCode: 'PLN',
    dueDate: new Date('2026-11-28T00:00:00Z'),
    metadata: null,
    buyerSnapshot: { name: 'Jan Kowalski', invoice_language: 'en', invoice_email: 'old@example.com' },
    sellerSnapshot: { legal_name: 'Seller sp. z o.o.', iban: 'PL61109010140000071219812874' },
    ...overrides,
  } as unknown as BillingInvoice
}

function makeEm(invoice: BillingInvoice | null, account: Record<string, unknown> | null = {}) {
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === BillingInvoice) return invoice
      if (entity === BillingAccount)
        return account === null
          ? null
          : { id: 'acc-1', name: 'Jan', invoiceEmail: 'jan@example.com', invoiceLanguage: 'en', autoSendInvoice: true, ...account }
      return null
    }),
    execute: jest.fn(async (sql: string, params: unknown[]) => {
      executed.push({ sql, params })
      return []
    }),
  }
  return { em, executed }
}

beforeEach(() => jest.clearAllMocks())

describe('sendInvoice', () => {
  it('emails the frozen PDF to the live invoice address and logs a sent delivery', async () => {
    const invoice = invoiceRow()
    const { em, executed } = makeEm(invoice)
    const sendEmail = jest.fn(async () => undefined)
    const result = await sendInvoice(em as never, { invoiceId: 'inv-1', ...scope, trigger: 'manual' }, { sendEmail, loadTranslator, now })

    expect(result).toEqual({ invoiceId: 'inv-1', to: 'jan@example.com', status: 'sent', error: null })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jan@example.com',
        subject: 'Invoice INV/2026/11/0001',
        attachments: [{ filename: 'INV-2026-11-0001.pdf', content: 'JVBERg==', contentType: 'application/pdf' }],
        tenantId: 't-1',
        organizationId: 'o-1',
      }),
    )
    const append = executed.find((e) => e.sql.includes('jsonb_set'))
    expect(JSON.parse(append!.params[0] as string)).toEqual([
      { at: '2026-11-14T12:00:00.000Z', to: 'jan@example.com', status: 'sent', error: null, trigger: 'manual' },
    ])
    expect(append!.params.slice(1)).toEqual(['inv-1', 't-1', 'o-1'])
    expect(emitBillingEvent).toHaveBeenCalledWith('billing.invoice.sent', expect.objectContaining({ invoiceId: 'inv-1', trigger: 'manual' }))
    expect(hasSuccessfulDelivery(invoice)).toBe(true)
  })

  it('records a failed delivery (no throw) when the transport fails', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { em, executed } = makeEm(invoiceRow())
    const sendEmail = jest.fn(async () => {
      throw new Error('EMAIL_TRANSPORT_NOT_CONFIGURED')
    })
    const result = await sendInvoice(em as never, { invoiceId: 'inv-1', ...scope, trigger: 'manual' }, { sendEmail, loadTranslator, now })
    expect(result).toMatchObject({ status: 'failed', error: 'EMAIL_TRANSPORT_NOT_CONFIGURED' })
    expect(JSON.parse(executed[0].params[0] as string)[0]).toMatchObject({ status: 'failed', error: 'EMAIL_TRANSPORT_NOT_CONFIGURED' })
    expect(emitBillingEvent).toHaveBeenCalledWith('billing.invoice.send_failed', expect.anything())
    spy.mockRestore()
  })

  it('refuses drafts and test documents with 409 not_posted', async () => {
    for (const overrides of [{ status: 'draft' }, { testRun: true }]) {
      const { em } = makeEm(invoiceRow(overrides))
      await expect(
        sendInvoice(em as never, { invoiceId: 'inv-1', ...scope, trigger: 'manual' }, { sendEmail: jest.fn(), loadTranslator }),
      ).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'billing.invoice.not_posted' }) })
    }
  })

  it('refuses placeholder and malformed addresses with 422 and sends nothing', async () => {
    const sendEmail = jest.fn()
    for (const invoiceEmail of ['shell-123@invalid.local', 'not-an-email']) {
      const { em, executed } = makeEm(invoiceRow(), { invoiceEmail })
      await expect(
        sendInvoice(em as never, { invoiceId: 'inv-1', ...scope, trigger: 'manual' }, { sendEmail, loadTranslator }),
      ).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'billing.invoice.email_invalid' }) })
      expect(executed).toHaveLength(0)
    }
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('falls back to the frozen buyer email when the account is gone; 404 for unknown invoices', async () => {
    const { em } = makeEm(invoiceRow(), null)
    const result = await sendInvoice(em as never, { invoiceId: 'inv-1', ...scope, trigger: 'manual' }, { sendEmail: jest.fn(async () => undefined), loadTranslator })
    expect(result.to).toBe('old@example.com')
    const missing = makeEm(null)
    await expect(sendInvoice(missing.em as never, { invoiceId: 'x', ...scope, trigger: 'manual' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('buildInvoiceEmail', () => {
  it('fills subject and body in the document language and escapes HTML', () => {
    const pl: Record<string, string> = {
      'billing.email.invoice.subject': 'Faktura {number}',
      'billing.email.invoice.greeting': 'Dzień dobry {name},',
    }
    const email = buildInvoiceEmail({
      invoice: { number: 'INV/1', totalGross: '123.0000', currencyCode: 'PLN', dueDate: new Date('2026-11-28T00:00:00Z') },
      buyerName: 'Jan <b>Kowalski</b>',
      sellerName: 'Seller',
      iban: 'PL61109010140000071219812874',
      language: 'pl',
      translate: (key, fallback) => pl[key] ?? fallback,
    })
    expect(email.subject).toBe('Faktura INV/1')
    expect(email.text).toContain('Dzień dobry Jan <b>Kowalski</b>,')
    expect(email.text).toContain('123,00 zł')
    expect(email.text).toContain('28.11.2026')
    expect(email.text).toContain('PL61 1090 1014 0000 0712 1981 2874')
    expect(email.html).toContain('Jan &lt;b&gt;Kowalski&lt;/b&gt;')
  })
})

describe('isDeliverableEmail', () => {
  it('accepts real addresses only', () => {
    expect(isDeliverableEmail('a@b.co')).toBe(true)
    expect(isDeliverableEmail('X@INVALID.LOCAL')).toBe(false)
    expect(isDeliverableEmail('')).toBe(false)
    expect(isDeliverableEmail(null)).toBe(false)
  })
})

describe('autoSendInvoice (subscriber)', () => {
  const payload = { invoiceId: 'inv-1', ...scope }

  it('sends once when the account opted in', async () => {
    const { em } = makeEm(invoiceRow())
    const sendEmail = jest.fn(async () => undefined)
    expect(await autoSendInvoice(em as never, payload, { sendEmail, loadTranslator, now })).toBe('sent')
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on redelivery (an auto delivery already succeeded)', async () => {
    const invoice = invoiceRow({ metadata: { deliveries: [{ at: 'x', to: 'a@b.co', status: 'sent', trigger: 'auto' }] } })
    const sendEmail = jest.fn()
    expect(await autoSendInvoice(makeEm(invoice).em as never, payload, { sendEmail, loadTranslator })).toBe('skipped')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips when the flag is off, the email is a placeholder, or the document is a receipt / test', async () => {
    const sendEmail = jest.fn()
    const deps = { sendEmail, loadTranslator }
    expect(await autoSendInvoice(makeEm(invoiceRow(), { autoSendInvoice: false }).em as never, payload, deps)).toBe('skipped')
    expect(await autoSendInvoice(makeEm(invoiceRow(), { invoiceEmail: 'x@invalid.local' }).em as never, payload, deps)).toBe('skipped')
    expect(await autoSendInvoice(makeEm(invoiceRow({ documentType: 'receipt' })).em as never, payload, deps)).toBe('skipped')
    expect(await autoSendInvoice(makeEm(invoiceRow({ testRun: true })).em as never, payload, deps)).toBe('skipped')
    expect(await autoSendInvoice(makeEm(invoiceRow()).em as never, { invoiceId: 'inv-1' }, deps)).toBe('skipped')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
