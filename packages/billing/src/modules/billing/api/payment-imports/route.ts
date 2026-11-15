import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { billingPaymentImportListQuerySchema } from '../../data/validators'

/** `GET /api/billing/payment-imports` — CSV upload batches, newest first (Spec C, C-D4). */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.payment.view'] },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()
    const query = billingPaymentImportListQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const em = (container.resolve('em') as EntityManager).fork()
    const where = ['tenant_id = ?', 'organization_id = ?', 'deleted_at IS NULL']
    const params: unknown[] = [auth.tenantId, organizationId]
    if (query.id) {
      where.push('id = ?')
      params.push(query.id)
    }
    const totalRows = (await em.execute(`SELECT COUNT(*)::int AS total FROM billing_payment_imports WHERE ${where.join(' AND ')}`, params)) as unknown as Array<{ total: number }>
    const total = totalRows?.[0]?.total ?? 0
    const items = await em.execute(
      `SELECT id, file_name, row_count, counts, user_id, created_at
         FROM billing_payment_imports WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    )
    return NextResponse.json({ items, total, page: query.page, pageSize: query.pageSize, totalPages: total === 0 ? 1 : Math.ceil(total / query.pageSize) })
  } catch (err) {
    console.error('[billing/payment-imports.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'List payment import batches',
      description: 'CSV uploads with counts per outcome (allocated, partially_allocated, matched, unmatched, duplicate, rejected).',
      query: billingPaymentImportListQuerySchema,
    },
  },
}
