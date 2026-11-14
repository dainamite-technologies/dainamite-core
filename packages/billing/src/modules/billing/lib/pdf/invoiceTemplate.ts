import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { NOTO_SANS_BOLD_BASE64, NOTO_SANS_REGULAR_BASE64 } from './fonts/embeddedFonts'
import type { InvoiceDocumentModel } from './invoiceModel'

/**
 * Built-in A4 invoice template (Spec B) — lays out an `InvoiceDocumentModel`
 * with pdf-lib and an embedded Unicode font (Noto Sans subset, so Polish
 * diacritics render — the standard Helvetica font cannot).
 *
 * Layout: logo + title | seller / buyer blocks | meta rows | lines table
 * (wrapped descriptions, header repeated on every page) | VAT summary |
 * totals | payment instructions | footer | "Page n of m" | optional
 * diagonal watermark (DRAFT / TEST). Characters the subset font lacks are
 * replaced with "?" so rendering never throws on exotic customer text.
 */

export type PdfLogo = { bytes: Uint8Array; mimeType: string }

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 40
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN
const FOOTER_HEIGHT = 48
const BODY_SIZE = 9
const SMALL_SIZE = 8
const LINE_GAP = 3

// # | description | qty | unit net | VAT % | net | VAT | gross  (sums to CONTENT_WIDTH)
const TABLE_COLUMNS = [24, 179, 30, 62, 36, 62, 56, 66.28]

const TEXT = rgb(0.12, 0.12, 0.14)
const MUTED = rgb(0.42, 0.42, 0.46)
const RULE = rgb(0.82, 0.82, 0.85)
const HEADER_FILL = rgb(0.95, 0.95, 0.96)
const WATERMARK = rgb(0.85, 0.85, 0.87)

type Fonts = { regular: PDFFont; bold: PDFFont; charset: Set<number> }

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

/** Replaces characters the embedded subset cannot draw. */
export function sanitizeForFont(text: string, charset: Set<number>): string {
  let out = ''
  for (const char of text.replace(/\t/g, ' ')) {
    const code = char.codePointAt(0) ?? 63
    out += code === 10 || charset.has(code) ? char : '?'
  }
  return out
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      // A single word wider than the column is split by characters.
      let chunk = ''
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > width && chunk) {
          lines.push(chunk)
          chunk = char
        } else {
          chunk += char
        }
      }
      current = chunk
    }
    lines.push(current)
  }
  return lines
}

class Layout {
  readonly pages: PDFPage[] = []
  page!: PDFPage
  y = 0

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
  ) {
    this.newPage()
  }

  get boldFont(): PDFFont {
    return this.fonts.bold
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.pages.push(this.page)
    this.y = PAGE_HEIGHT - MARGIN
  }

  /** Starts a new page when fewer than `height` points remain above the footer. */
  ensure(height: number): boolean {
    if (this.y - height < MARGIN + FOOTER_HEIGHT) {
      this.newPage()
      return true
    }
    return false
  }

  text(value: string, x: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; y?: number } = {}) {
    const size = opts.size ?? BODY_SIZE
    this.page.drawText(sanitizeForFont(value, this.fonts.charset), {
      x,
      y: opts.y ?? this.y,
      size,
      font: opts.bold ? this.fonts.bold : this.fonts.regular,
      color: opts.color ?? TEXT,
    })
  }

  width(value: string, size: number, bold = false): number {
    return (bold ? this.fonts.bold : this.fonts.regular).widthOfTextAtSize(sanitizeForFont(value, this.fonts.charset), size)
  }

  rule(y = this.y): void {
    this.page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: RULE })
  }
}

function drawTableHeader(layout: Layout, headers: string[], align: Array<'left' | 'right'>, columns: number[], x0 = MARGIN) {
  // Headers wrap inside their column (Polish labels are long: "Cena netto").
  const wrapped = headers.map((header, i) => wrap(header, layout.boldFont, SMALL_SIZE, columns[i] - 6))
  const lineHeight = SMALL_SIZE + 2
  const height = Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + 8
  const total = columns.reduce((sum, w) => sum + w, 0)
  layout.page.drawRectangle({ x: x0, y: layout.y - height + 4, width: total, height, color: HEADER_FILL })
  let x = x0
  wrapped.forEach((lines, i) => {
    const w = columns[i]
    lines.forEach((line, li) => {
      const tx = align[i] === 'right' ? x + w - 3 - layout.width(line, SMALL_SIZE, true) : x + 3
      layout.text(line, tx, { size: SMALL_SIZE, bold: true, y: layout.y - SMALL_SIZE - 1 - li * lineHeight })
    })
    x += w
  })
  layout.y -= height + 2
}

function drawRows(
  layout: Layout,
  rows: string[][],
  headers: string[],
  align: Array<'left' | 'right'>,
  columns: number[],
  fonts: Fonts,
  x0 = MARGIN,
) {
  const lineHeight = BODY_SIZE + LINE_GAP
  for (const row of rows) {
    const cells = row.map((cell, i) =>
      wrap(sanitizeForFont(cell, fonts.charset), fonts.regular, BODY_SIZE, columns[i] - 6),
    )
    const rowHeight = Math.max(...cells.map((c) => c.length)) * lineHeight + 4
    if (layout.ensure(rowHeight)) drawTableHeader(layout, headers, align, columns, x0)
    let x = x0
    cells.forEach((cellLines, i) => {
      const w = columns[i]
      cellLines.forEach((line, li) => {
        const tx = align[i] === 'right' ? x + w - 3 - layout.width(line, BODY_SIZE) : x + 3
        layout.text(line, tx, { y: layout.y - BODY_SIZE - li * lineHeight })
      })
      x += w
    })
    layout.y -= rowHeight
    layout.page.drawLine({
      start: { x: x0, y: layout.y + 1 },
      end: { x: x0 + columns.reduce((s, w) => s + w, 0), y: layout.y + 1 },
      thickness: 0.3,
      color: RULE,
    })
  }
}

function drawBlock(layout: Layout, heading: string, lines: string[], x: number, width: number, top: number, fonts: Fonts): number {
  let y = top
  layout.text(heading.toUpperCase(), x, { size: SMALL_SIZE, bold: true, color: MUTED, y })
  y -= SMALL_SIZE + 6
  lines.forEach((line, index) => {
    for (const part of wrap(sanitizeForFont(line, fonts.charset), index === 0 ? fonts.bold : fonts.regular, BODY_SIZE, width)) {
      layout.text(part, x, { bold: index === 0, y })
      y -= BODY_SIZE + LINE_GAP
    }
  })
  return y
}

async function embedLogo(doc: PDFDocument, logo: PdfLogo | null | undefined): Promise<PDFImage | null> {
  if (!logo) return null
  try {
    if (logo.mimeType === 'image/png') return await doc.embedPng(logo.bytes)
    if (logo.mimeType === 'image/jpeg' || logo.mimeType === 'image/jpg') return await doc.embedJpg(logo.bytes)
  } catch (err) {
    console.warn('[billing.pdf] logo could not be embedded', err)
  }
  return null
}

export async function renderInvoicePdf(model: InvoiceDocumentModel, opts: { logo?: PdfLogo | null } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  // subset: false — the fonts are already subset at build time, and pdf-lib's
  // own subsetting drops kerning on some glyph runs.
  const regular = await doc.embedFont(base64ToBytes(NOTO_SANS_REGULAR_BASE64), { subset: false })
  const bold = await doc.embedFont(base64ToBytes(NOTO_SANS_BOLD_BASE64), { subset: false })
  const fonts: Fonts = { regular, bold, charset: new Set(regular.getCharacterSet()) }
  doc.setTitle(sanitizeForFont(`${model.title} ${model.number}`, fonts.charset))
  doc.setLanguage(model.language)
  doc.setProducer('Dainamite Billing')

  const layout = new Layout(doc, fonts)

  // ── Header: logo left, title + number right ──
  const logo = await embedLogo(doc, opts.logo)
  if (logo) {
    const scale = Math.min(140 / logo.width, 48 / logo.height, 1)
    layout.page.drawImage(logo, {
      x: MARGIN,
      y: layout.y - logo.height * scale,
      width: logo.width * scale,
      height: logo.height * scale,
    })
  }
  const titleSize = 18
  layout.text(model.title, PAGE_WIDTH - MARGIN - layout.width(model.title, titleSize, true), {
    size: titleSize,
    bold: true,
    y: layout.y - titleSize,
  })
  layout.text(model.number, PAGE_WIDTH - MARGIN - layout.width(model.number, 11), {
    size: 11,
    color: MUTED,
    y: layout.y - titleSize - 16,
  })
  layout.y -= 64

  // ── Meta rows (right-aligned key: value list) ──
  for (const [label, value] of model.meta) {
    const text = `${label}: ${value}`
    layout.text(text, PAGE_WIDTH - MARGIN - layout.width(text, BODY_SIZE), { y: layout.y })
    layout.y -= BODY_SIZE + LINE_GAP
  }
  layout.y -= 10

  // ── Seller | Buyer ──
  const half = CONTENT_WIDTH / 2 - 10
  const top = layout.y
  const sellerBottom = drawBlock(layout, model.seller.heading, model.seller.lines, MARGIN, half, top, fonts)
  const buyerBottom = drawBlock(layout, model.buyer.heading, model.buyer.lines, MARGIN + half + 20, half, top, fonts)
  layout.y = Math.min(sellerBottom, buyerBottom) - 14

  // ── Lines ──
  layout.ensure(40)
  drawTableHeader(layout, model.table.headers, model.table.align, TABLE_COLUMNS)
  drawRows(layout, model.table.rows, model.table.headers, model.table.align, TABLE_COLUMNS, fonts)
  layout.y -= 14

  // ── VAT summary (right half) + totals ──
  const summaryColumns = [60, 75, 70, 85]
  const summaryX = PAGE_WIDTH - MARGIN - summaryColumns.reduce((s, w) => s + w, 0)
  layout.ensure(SMALL_SIZE + 30 + model.vatSummary.rows.length * (BODY_SIZE + 7))
  layout.text(model.vatSummary.heading, summaryX, { size: SMALL_SIZE, bold: true, color: MUTED })
  layout.y -= SMALL_SIZE + 4
  const summaryAlign: Array<'left' | 'right'> = ['right', 'right', 'right', 'right']
  drawTableHeader(layout, model.vatSummary.headers, summaryAlign, summaryColumns, summaryX)
  drawRows(layout, model.vatSummary.rows, model.vatSummary.headers, summaryAlign, summaryColumns, fonts, summaryX)
  layout.y -= 10

  layout.ensure(model.totals.length * 16 + 10)
  model.totals.forEach(([label, value], index) => {
    const last = index === model.totals.length - 1
    const size = last ? 12 : BODY_SIZE + 1
    layout.text(value, PAGE_WIDTH - MARGIN - layout.width(value, size, last), { size, bold: last })
    layout.text(label, summaryX, { size, bold: last, color: last ? TEXT : MUTED })
    layout.y -= size + 6
  })
  layout.y -= 10

  // ── Payment instructions ──
  if (model.payment) {
    layout.ensure((model.payment.lines.length + 1) * (BODY_SIZE + LINE_GAP) + 16)
    layout.rule(layout.y + 4)
    layout.y -= 10
    layout.text(model.payment.heading.toUpperCase(), MARGIN, { size: SMALL_SIZE, bold: true, color: MUTED })
    layout.y -= SMALL_SIZE + 6
    for (const line of model.payment.lines) {
      layout.text(line, MARGIN)
      layout.y -= BODY_SIZE + LINE_GAP
    }
  }

  // ── Footer, page numbers, watermark on every page ──
  const pages = layout.pages
  pages.forEach((page, index) => {
    layout.page = page
    let fy = MARGIN + FOOTER_HEIGHT - 14
    for (const line of model.footer.slice(0, 3)) {
      for (const part of wrap(sanitizeForFont(line, fonts.charset), regular, SMALL_SIZE - 1, CONTENT_WIDTH - 90).slice(0, 2)) {
        layout.text(part, MARGIN, { size: SMALL_SIZE - 1, color: MUTED, y: fy })
        fy -= SMALL_SIZE + 1
      }
    }
    const pageText = model.pageLabel(index + 1, pages.length)
    layout.text(pageText, PAGE_WIDTH - MARGIN - layout.width(pageText, SMALL_SIZE), {
      size: SMALL_SIZE,
      color: MUTED,
      y: MARGIN,
    })
    if (model.watermark) {
      const size = 96
      const text = sanitizeForFont(model.watermark, fonts.charset)
      const w = bold.widthOfTextAtSize(text, size)
      page.drawText(text, {
        x: PAGE_WIDTH / 2 - (w / 2) * Math.cos(Math.PI / 4),
        y: PAGE_HEIGHT / 2 - (w / 2) * Math.sin(Math.PI / 4),
        size,
        font: bold,
        color: WATERMARK,
        rotate: degrees(45),
        opacity: 0.5,
      })
    }
  })

  return doc.save()
}
