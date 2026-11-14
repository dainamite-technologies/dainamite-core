import { PDFDocument } from 'pdf-lib'
import {
  buildInvoiceDocumentModel,
  type DocumentTranslate,
  type PdfInvoice,
  type PdfLine,
} from '../../../lib/pdf/invoiceModel'
import { renderInvoicePdf, sanitizeForFont } from '../../../lib/pdf/invoiceTemplate'
import en from '../../../i18n/en.json'
import pl from '../../../i18n/pl.json'

const translator = (dict: Record<string, string>): DocumentTranslate => (key, fallback) => dict[key] ?? fallback

const invoice: PdfInvoice = {
  number: 'INV/2026/11/0007',
  documentType: 'invoice',
  status: 'posted',
  testRun: false,
  issueDate: '2026-11-14',
  dueDate: '2026-11-28',
  billDate: '2026-11-01',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  currencyCode: 'PLN',
  subtotalNet: '148.3300',
  taxTotal: '25.6700',
  totalGross: '174.0000',
}

const line = (overrides: Partial<PdfLine> = {}): PdfLine => ({
  description: 'Internet 300 Mb/s',
  quantity: '1.0000',
  unitPriceNet: '100.0000',
  taxRate: '23',
  netAmount: '100.0000',
  taxAmount: '23.0000',
  grossAmount: '123.0000',
  servicePeriodStart: '2026-11-01',
  servicePeriodEnd: '2026-11-30',
  ...overrides,
})

const lines = [
  line(),
  line({ description: 'Wsparcie priorytetowe', unitPriceNet: '33.3300', taxRate: '8', netAmount: '33.3300', taxAmount: '2.6700', grossAmount: '36.0000' }),
  line({ description: 'Kopie zapasowe', unitPriceNet: '15.0000', taxRate: '0', netAmount: '15.0000', taxAmount: '0.0000', grossAmount: '15.0000', servicePeriodStart: null, servicePeriodEnd: null }),
]

const seller = {
  legalName: 'Żółta Łódź sp. z o.o.',
  address: { line1: 'ul. Świętokrzyska 1', city: 'Kraków', postal_code: '30-001', country: 'PL' },
  taxId: 'PL1234563218',
  bankName: 'Bank Śląski',
  iban: 'PL61109010140000071219812874',
  bic: 'WBKPPLPP',
  footer: 'KRS 0000000000\nKapitał zakładowy 5 000 zł',
}

const buyer = { name: 'Jan Kowalski', address: { line1: 'ul. Testowa 1', city: 'Warszawa', postal_code: '00-001', country: 'PL' }, taxId: null }

function model(language: 'en' | 'pl', overrides: Partial<PdfInvoice> = {}, docLines: PdfLine[] = lines) {
  return buildInvoiceDocumentModel({
    invoice: { ...invoice, ...overrides },
    lines: docLines,
    seller,
    buyer,
    language,
    translate: translator(language === 'pl' ? (pl as Record<string, string>) : (en as Record<string, string>)),
  })
}

describe('buildInvoiceDocumentModel', () => {
  it('builds English labels, en-GB dates and the payment title with the invoice number', () => {
    const m = model('en')
    expect(m.title).toBe('VAT invoice')
    expect(m.meta).toEqual(
      expect.arrayContaining([
        ['Number', 'INV/2026/11/0007'],
        ['Issue date', '14/11/2026'],
        ['Due date', '28/11/2026'],
      ]),
    )
    expect(m.payment?.lines).toEqual(
      expect.arrayContaining(['IBAN: PL61 1090 1014 0000 0712 1981 2874', 'Transfer title: INV/2026/11/0007']),
    )
    expect(m.watermark).toBeNull()
    expect(m.pageLabel(1, 3)).toBe('Page 1 of 3')
  })

  it('builds Polish labels and pl-PL money / dates', () => {
    const m = model('pl')
    expect(m.title).toBe('Faktura VAT')
    expect(m.meta).toEqual(expect.arrayContaining([['Data wystawienia', '14.11.2026'], ['Termin płatności', '28.11.2026']]))
    expect(m.totals[2]).toEqual(['Do zapłaty', '174,00 zł'])
    expect(m.payment?.lines).toContain('Tytuł przelewu: INV/2026/11/0007')
    expect(m.seller.heading).toBe('Sprzedawca')
  })

  it('groups the VAT summary by rate (highest first) and it adds up to the totals', () => {
    const m = model('en')
    expect(m.vatSummary.rows.map((r) => r[0])).toEqual(['23 %', '8 %', '0 %'])
    const parse = (s: string) => Number.parseFloat(s.replace(/[^0-9.-]/g, ''))
    const vat = m.vatSummary.rows.reduce((sum, r) => sum + parse(r[2]), 0)
    expect(vat.toFixed(2)).toBe('25.67')
  })

  it('prints the service period on lines that carry one, once', () => {
    const m = model('en')
    expect(m.table.rows[0][1]).toBe('Internet 300 Mb/s (01/11/2026 – 30/11/2026)')
    expect(m.table.rows[2][1]).toBe('Kopie zapasowe')
    const dated = model('en', {}, [line({ description: 'Plan · 2026-11-15 – 2026-11-30' })])
    expect(dated.table.rows[0][1]).toBe('Plan · 2026-11-15 – 2026-11-30')
  })

  it('watermarks drafts (no issue / due date yet) and test documents', () => {
    const draft = model('en', { status: 'draft', number: 'DRAFT-1A2B3C4D', issueDate: null, dueDate: null })
    expect(draft.watermark).toBe('DRAFT')
    expect(draft.meta).toEqual(expect.arrayContaining([['Issue date', '—']]))
    expect(model('pl', { status: 'draft', testRun: true }).watermark).toBe('TEST')
  })

  it('has no payment block without an IBAN or for receipts / credit memos', () => {
    expect(
      buildInvoiceDocumentModel({ invoice, lines, seller: { ...seller, iban: null }, buyer, language: 'en', translate: translator({}) }).payment,
    ).toBeNull()
    expect(model('en', { documentType: 'receipt' }).payment).toBeNull()
    const memo = model('en', { documentType: 'credit_memo', correctsNumber: 'INV/2026/10/0003' })
    expect(memo.title).toBe('Credit memo')
    expect(memo.payment).toBeNull()
    expect(memo.meta).toEqual(expect.arrayContaining([['Corrects', 'INV/2026/10/0003']]))
  })

  it('splits the footer into lines and falls back to English for unknown languages', () => {
    expect(model('en').footer).toEqual(['KRS 0000000000', 'Kapitał zakładowy 5 000 zł'])
    const de = buildInvoiceDocumentModel({ invoice, lines, seller, buyer, language: 'de', translate: translator({}) })
    expect(de.meta[1]).toEqual(['Issue date', '14/11/2026'])
  })
})

describe('renderInvoicePdf', () => {
  it('renders a one-page A4 document with Polish text and the embedded font', async () => {
    const bytes = await renderInvoicePdf(model('pl'))
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const [page] = doc.getPages()
    expect(Math.round(page.getWidth())).toBe(595)
    expect(doc.getTitle()).toBe('Faktura VAT INV/2026/11/0007')
  }, 30_000)

  it('paginates long invoices, repeating the table on every page', async () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        line({ description: `Usługa nr ${i + 1}`, servicePeriodStart: null, servicePeriodEnd: null }),
      )
    const pages = async (n: number) =>
      (await PDFDocument.load(await renderInvoicePdf(model('pl', { status: 'draft' }, rows(n))))).getPageCount()
    // ~31 single-line rows fit under the header on page 1, ~44 on later pages;
    // the VAT summary, totals and payment block follow the last row.
    expect(await pages(10)).toBe(1)
    expect(await pages(40)).toBe(2)
    expect(await pages(80)).toBe(3)
  }, 30_000)

  it('wraps long descriptions instead of overflowing the column', async () => {
    const long = line({ description: 'Bardzo długi opis usługi '.repeat(12) })
    const bytes = await renderInvoicePdf(model('en', {}, [long]))
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  }, 30_000)

  it('never throws on characters outside the font (they become "?")', async () => {
    const exotic = buildInvoiceDocumentModel({
      invoice,
      lines: [line({ description: 'Тест 中文 🚀' })],
      seller,
      buyer: { ...buyer, name: 'Ελληνικά' },
      language: 'en',
      translate: translator({}),
    })
    await expect(renderInvoicePdf(exotic)).resolves.toBeInstanceOf(Uint8Array)
    expect(sanitizeForFont('Zażółć 🚀', new Set([...'Zażółć '].map((c) => c.codePointAt(0)!)))).toBe('Zażółć ?')
  }, 30_000)
})
