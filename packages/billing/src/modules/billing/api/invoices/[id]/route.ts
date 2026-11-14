import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

/**
 * `GET /api/billing/invoices/[id]` — one billing document with its lines
 * (Spec 0: `billing_invoices` / `billing_invoice_lines`). Documents of other
 * modules are never reachable here.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.invoice.view'] },
}

type InvoiceRow = Record<string, unknown> & { id: string; bill_account_id: string }
type InvoiceLineRow = Record<string, unknown> & { id: string }

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const organizationId = (auth as { orgId?: string }).orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization scope required' },
        { status: 403 },
      )
    }

    const { id: invoiceId } = await params
    const em = (container.resolve('em') as EntityManager).fork()

    const invoiceRows = (await em.execute(
      `SELECT i.id, i.number, i.document_type, i.series, i.status, i.test_run, i.bill_account_id,
              a.name AS bill_account_name, i.bill_run_id, i.bill_date, i.period_start, i.period_end,
              i.issue_date, i.due_date, i.posted_at, i.currency_code, i.subtotal_net, i.tax_total,
              i.total_gross, i.paid_total, i.credited_total, i.outstanding, i.corrects_invoice_id,
              i.correction_reason, i.buyer_snapshot, i.seller_snapshot, i.topup_id, i.metadata,
              i.created_at, i.updated_at
       FROM billing_invoices i
       LEFT JOIN billing_accounts a ON a.id = i.bill_account_id AND a.tenant_id = i.tenant_id
       WHERE i.id = ? AND i.tenant_id = ? AND i.organization_id = ? AND i.deleted_at IS NULL`,
      [invoiceId, auth.tenantId, organizationId],
    )) as unknown as InvoiceRow[]

    if (!invoiceRows || invoiceRows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = invoiceRows[0]

    const lineRows = (await em.execute(
      `SELECT id, line_number, billing_item_id, billing_type, description, quantity,
              unit_price_net, tax_rate, net_amount, tax_amount, gross_amount,
              service_period_start, service_period_end, corrects_line_id, metadata
       FROM billing_invoice_lines
       WHERE invoice_id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL
       ORDER BY line_number ASC`,
      [invoiceId, auth.tenantId, organizationId],
    )) as unknown as InvoiceLineRow[]

    return NextResponse.json({
      invoice,
      // Lines carry the document currency for display convenience.
      lines: lineRows.map((line) => ({ ...line, currency_code: invoice.currency_code })),
    })
  } catch (err) {
    console.error('[billing/invoices/[id].GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Get a billing document (with lines)',
      description:
        'Returns one billing document from `billing_invoices` (invoice, memo or receipt) with its ' +
        'lines, the frozen buyer / seller snapshots and `bill_account_name`. 404 outside the ' +
        'caller\'s organization.',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
    },
  },
}
