import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'

/**
 * `GET /api/billing/payments/[id]` — one payment with its active
 * allocations (invoice number, amount, who / how allocated) — Spec C.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.payment.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()
    const { id } = await params
    const em = (container.resolve('em') as EntityManager).fork()
    const rows = (await em.execute(
      `SELECT p.*, a.name AS bill_account_name, a.billing_mode AS bill_account_mode
         FROM billing_payments p
         LEFT JOIN billing_accounts a ON a.id = p.bill_account_id AND a.tenant_id = p.tenant_id
        WHERE p.id = ? AND p.tenant_id = ? AND p.organization_id = ? AND p.deleted_at IS NULL`,
      [id, auth.tenantId, organizationId],
    )) as unknown as Array<Record<string, unknown>>
    if (!rows?.length) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    const allocations = await em.execute(
      `SELECT al.id, al.invoice_id, i.number AS invoice_number, i.document_type, i.status AS invoice_status,
              al.amount, al.currency_code, al.allocated_by, al.user_id, al.created_at
         FROM billing_allocations al
         LEFT JOIN billing_invoices i ON i.id = al.invoice_id
        WHERE al.source_type = 'payment' AND al.source_id = ? AND al.tenant_id = ? AND al.organization_id = ?
          AND al.deleted_at IS NULL
        ORDER BY al.created_at ASC`,
      [id, auth.tenantId, organizationId],
    )
    return NextResponse.json({ payment: rows[0], allocations })
  } catch (err) {
    console.error('[billing/payments/[id].GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Get a billing payment',
      description: 'The payment (incl. match reason, account, top-up link) and its active allocations.',
      responses: [{ status: 200, description: '`{ payment, allocations[] }`' }],
      errors: [{ status: 404, description: 'Payment not found in this organization' }],
    },
  },
}
