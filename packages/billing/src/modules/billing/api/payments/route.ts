import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { billingPaymentListQuerySchema } from '../../data/validators'
import { runCommandRoute } from '../../lib/commandRoute'

/**
 * `GET /api/billing/payments` — the payment register (Spec C), newest first.
 * Filters: status, billAccountId, importId, receivedFrom / receivedTo,
 * search (reference / payer name / payer account). Rows carry the account
 * name (joined). Hand-written SQL like the invoice list.
 *
 * `POST /api/billing/payments` — manual payment entry (`billing.payments.create`).
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.payment.view'] },
  POST: { requireAuth: true, requireFeatures: ['billing.payment.manage'] },
}

export type BillingPaymentRow = {
  id: string
  received_at: string
  amount: string
  currency_code: string
  reference: string | null
  payer_name: string | null
  payer_account: string | null
  source: string
  import_id: string | null
  bill_account_id: string | null
  bill_account_name: string | null
  status: string
  unallocated_amount: string
  match_reason: string | null
  topup_id: string | null
  created_at: string
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()
    const query = billingPaymentListQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const em = (container.resolve('em') as EntityManager).fork()

    const where: string[] = ['p.tenant_id = ?', 'p.organization_id = ?', 'p.deleted_at IS NULL']
    const params: unknown[] = [auth.tenantId, organizationId]
    const filters: Array<[unknown, string]> = [
      [query.id, 'p.id = ?'],
      [query.status, 'p.status = ?'],
      [query.billAccountId, 'p.bill_account_id = ?'],
      [query.importId, 'p.import_id = ?'],
      [query.receivedFrom, 'p.received_at >= ?::date'],
      [query.receivedTo, 'p.received_at <= ?::date'],
    ]
    for (const [value, clause] of filters) {
      if (value === undefined || value === null || value === '') continue
      where.push(clause)
      params.push(value)
    }
    if (query.search) {
      const like = `%${query.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
      where.push('(p.reference ILIKE ? OR p.payer_name ILIKE ? OR p.payer_account ILIKE ?)')
      params.push(like, like, like)
    }
    const whereSql = where.join(' AND ')
    const totalRows = (await em.execute(`SELECT COUNT(*)::int AS total FROM billing_payments p WHERE ${whereSql}`, params)) as unknown as Array<{ total: number }>
    const total = totalRows?.[0]?.total ?? 0
    const items = (await em.execute(
      `SELECT p.id, p.received_at, p.amount, p.currency_code, p.reference, p.payer_name, p.payer_account, p.source,
              p.import_id, p.bill_account_id, a.name AS bill_account_name, p.status, p.unallocated_amount,
              p.match_reason, p.topup_id, p.created_at
         FROM billing_payments p
         LEFT JOIN billing_accounts a ON a.id = p.bill_account_id AND a.tenant_id = p.tenant_id
        WHERE ${whereSql}
        ORDER BY p.received_at DESC, p.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    )) as unknown as BillingPaymentRow[]
    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 1 : Math.ceil(total / query.pageSize),
    })
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Invalid query', issues: err.issues }, { status: 400 })
    console.error('[billing/payments.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

const createBodySchema = z.object({
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().positive(),
  currencyCode: z.string().trim().length(3),
  reference: z.string().trim().max(500).optional(),
  payerName: z.string().trim().max(255).optional(),
  payerAccount: z.string().trim().max(64).optional(),
  billAccountId: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.payments.create',
    bodySchema: createBodySchema,
    resourceKind: 'billing.payment',
    resourceId: () => null,
    logLabel: 'billing/payments.POST',
  })
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'List billing payments',
      description:
        'Payment register (bank CSV lines, manual entries, gateway captures). Filters: status ' +
        '(`unmatched | matched | partially_allocated | allocated | ignored | converted_to_topup`), billAccountId, ' +
        'importId, receivedFrom / receivedTo (YYYY-MM-DD), search (reference, payer). pageSize ≤ 100.',
      query: billingPaymentListQuerySchema,
    },
    POST: {
      tags: ['Billing'],
      summary: 'Record a payment manually',
      description:
        'Creates a manual payment. With `billAccountId` it is matched and applied as credit to the ' +
        "account's open invoices (oldest due first); otherwise it stays unmatched.",
      requestBody: { schema: createBodySchema },
      responses: [{ status: 200, description: '`{ paymentId, status, unallocatedAmount }`' }],
      errors: [{ status: 409, description: '`billing.payment.currency_mismatch`' }],
    },
  },
}
