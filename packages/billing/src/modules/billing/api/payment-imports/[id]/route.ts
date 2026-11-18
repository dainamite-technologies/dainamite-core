import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'

/** `GET /api/billing/payment-imports/[id]` — one upload batch with its row errors (Spec C). */

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
      `SELECT id, file_name, row_count, counts, errors, user_id, created_at
         FROM billing_payment_imports
        WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [id, auth.tenantId, organizationId],
    )) as unknown as Array<Record<string, unknown>>
    if (!rows?.length) return NextResponse.json({ error: 'Import not found' }, { status: 404 })
    return NextResponse.json({ import: rows[0] })
  } catch (err) {
    console.error('[billing/payment-imports/[id].GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Get a payment import batch',
      description: 'Counts per outcome and the row errors (line number + message, capped at 200).',
      responses: [{ status: 200, description: '`{ import }`' }],
      errors: [{ status: 404, description: 'Import not found' }],
    },
  },
}
