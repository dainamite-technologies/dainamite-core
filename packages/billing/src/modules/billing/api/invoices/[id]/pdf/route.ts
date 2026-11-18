import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { BillingInvoice } from '../../../../data/entities'
import { getInvoicePdf } from '../../../../lib/pdf/invoicePdf'
import { INVOICE_LANGUAGE_CODES } from '../../../../lib/invoiceLanguages'

/**
 * `GET /api/billing/invoices/[id]/pdf` — the document PDF (Spec B).
 *
 * Posted documents: the frozen attachment (rendered and frozen on first
 * request if freezing failed at post). Drafts / test documents: a live
 * render with a DRAFT / TEST watermark, never stored. `?download=1` forces
 * an attachment disposition; otherwise the browser shows it inline.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.invoice.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const organizationId = (auth as { orgId?: string }).orgId ?? null
    if (!organizationId) {
      return NextResponse.json({ error: 'Organization scope required' }, { status: 403 })
    }
    const { id } = await params
    const em = (container.resolve('em') as EntityManager).fork()
    const invoice = await em.findOne(BillingInvoice, {
      id,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    const pdf = await getInvoicePdf(em, invoice)
    const download = new URL(req.url).searchParams.get('download') === '1'
    return new NextResponse(Buffer.from(pdf.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.bytes.byteLength),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${pdf.fileName}"`,
        // Drafts change with every edit; frozen documents never do.
        'Cache-Control': pdf.frozen ? 'private, max-age=300' : 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    console.error('[billing/invoices/[id]/pdf.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Download a billing document PDF',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'download', in: 'query', required: false, schema: { type: 'string', enum: ['1'] } },
      ],
      description:
        '`application/pdf`. Posted documents return the PDF frozen at post (an attachment); drafts ' +
        'and test documents are rendered live with a DRAFT / TEST watermark and never stored. ' +
        `Labels follow the account invoice language (${INVOICE_LANGUAGE_CODES.join(' / ')}).`,
      responses: [{ status: 200, description: 'PDF document (`application/pdf`)' }],
      errors: [{ status: 404, description: 'Invoice not found in this organization' }],
    },
  },
}
