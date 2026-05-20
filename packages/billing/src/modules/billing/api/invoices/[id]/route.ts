import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

/**
 * `GET /api/billing/invoices/[id]` — billing-invoice detail.
 *
 * Returns the `core/sales` invoice row + its lines, but only if the
 * invoice is billing-managed (carries `metadata.bill_run_id`). Other
 * `core/sales` invoices return 404 here even though the same UUID
 * resolves at `/api/sales/invoices/[id]` — this endpoint is the
 * billing operator's surface, scoped to the billing universe.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.invoice.view'] },
}

type InvoiceRow = {
  id: string
  invoice_number: string
  status: string | null
  status_entry_id: string | null
  currency_code: string
  issue_date: string | null
  due_date: string | null
  subtotal_net_amount: string
  subtotal_gross_amount: string
  discount_total_amount: string
  tax_total_amount: string
  grand_total_net_amount: string
  grand_total_gross_amount: string
  paid_total_amount: string
  outstanding_amount: string
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type InvoiceLineRow = {
  id: string
  line_number: number
  kind: string
  description: string | null
  quantity: string
  currency_code: string
  unit_price_net: string
  unit_price_gross: string
  tax_rate: string
  tax_amount: string
  total_net_amount: string
  total_gross_amount: string
  metadata: Record<string, unknown> | null
}

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
      `SELECT id, invoice_number, status, status_entry_id, currency_code,
              issue_date, due_date,
              subtotal_net_amount, subtotal_gross_amount,
              discount_total_amount, tax_total_amount,
              grand_total_net_amount, grand_total_gross_amount,
              paid_total_amount, outstanding_amount,
              metadata, created_at, updated_at
       FROM sales_invoices
       WHERE id = ?
         AND tenant_id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
         AND jsonb_exists(metadata, 'bill_run_id')`,
      [invoiceId, auth.tenantId, organizationId],
    )) as unknown as InvoiceRow[]

    if (!invoiceRows || invoiceRows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = invoiceRows[0]

    const lineRows = (await em.execute(
      `SELECT id, line_number, kind, description, quantity, currency_code,
              unit_price_net, unit_price_gross, tax_rate, tax_amount,
              total_net_amount, total_gross_amount, metadata
       FROM sales_invoice_lines
       WHERE invoice_id = ?
         AND tenant_id = ?
         AND organization_id = ?
       ORDER BY line_number ASC`,
      [invoiceId, auth.tenantId, organizationId],
    )) as unknown as InvoiceLineRow[]

    return NextResponse.json({
      invoice,
      lines: lineRows,
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
      summary: 'Get a billing-managed invoice (with lines)',
      description:
        'Returns the `core/sales` invoice + every line, scoped to ' +
        "billing-managed invoices (`metadata.bill_run_id` set). Non-" +
        'billing invoices return 404 even when the UUID resolves at ' +
        '`/api/sales/invoices/[id]`.',
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
