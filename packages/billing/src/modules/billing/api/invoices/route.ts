import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

/**
 * `GET /api/billing/invoices`
 *
 * Lists `core/sales` invoices that the billing engine emitted (i.e.
 * carry `metadata.bill_run_id`). Hand-rolled rather than wrapped via
 * `makeCrudRoute` because the filter predicate is a JSONB
 * `metadata->>'bill_run_id' IS NOT NULL` check that doesn't map
 * cleanly onto the factory's `where`-shaped filter API, and the
 * entity itself is owned by `core/sales` — keeping the surface
 * read-only and hand-rolled avoids surprising the cross-module
 * reviewer.
 *
 * Filters:
 *   - `status` — draft / posted / paid / void
 *   - `billRunId` — exact match on `metadata->>'bill_run_id'`
 *   - `billAccountId` — exact match on `metadata->>'bill_account_id'`
 *   - `testRun=true|false` — flips the `metadata->>'test_run'` filter
 *   - `search` — substring on invoice_number
 *
 * Sort: started_at DESC (most recent first). Pagination: standard
 * page / pageSize (capped at 100).
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.invoice.view'] },
}

const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['draft', 'posted', 'paid', 'void']).optional(),
    billRunId: z.string().uuid().optional(),
    billAccountId: z.string().uuid().optional(),
    testRun: z.coerce.boolean().optional(),
    search: z.string().optional(),
  })
  .passthrough()

type BillingInvoiceRow = {
  id: string
  invoice_number: string
  status: string | null
  currency_code: string
  issue_date: string | null
  due_date: string | null
  subtotal_net_amount: string
  grand_total_net_amount: string
  grand_total_gross_amount: string
  paid_total_amount: string
  outstanding_amount: string
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export async function GET(req: Request) {
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

    const url = new URL(req.url)
    const query = querySchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    )

    const em = (container.resolve('em') as EntityManager).fork()

    // Build the predicate. `jsonb_exists(metadata, 'bill_run_id')` is
    // the function form of the JSONB `?` "key exists" operator — the
    // operator form cannot be used here because `em.execute` treats a
    // literal `?` as a positional parameter placeholder. Keeps us
    // narrow to billing-managed invoices, never bleeding into invoices
    // written by other modules.
    const whereClauses: string[] = [
      'tenant_id = ?',
      'organization_id = ?',
      'deleted_at IS NULL',
      "jsonb_exists(metadata, 'bill_run_id')",
    ]
    const params: unknown[] = [auth.tenantId, organizationId]

    if (query.status) {
      whereClauses.push('status = ?')
      params.push(query.status)
    }
    if (query.billRunId) {
      whereClauses.push("metadata->>'bill_run_id' = ?")
      params.push(query.billRunId)
    }
    if (query.billAccountId) {
      whereClauses.push("metadata->>'bill_account_id' = ?")
      params.push(query.billAccountId)
    }
    if (typeof query.testRun === 'boolean') {
      if (query.testRun) {
        whereClauses.push("metadata->>'test_run' = 'true'")
      } else {
        whereClauses.push("(metadata->>'test_run' IS NULL OR metadata->>'test_run' != 'true')")
      }
    }
    if (typeof query.search === 'string' && query.search.trim()) {
      whereClauses.push('invoice_number ILIKE ?')
      params.push(`%${query.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`)
    }

    const whereSql = whereClauses.join(' AND ')
    const countRows = (await em.execute(
      `SELECT COUNT(*)::int AS total FROM sales_invoices WHERE ${whereSql}`,
      params,
    )) as unknown as Array<{ total: number }>
    const total = countRows?.[0]?.total ?? 0

    const offset = (query.page - 1) * query.pageSize
    const itemRows = (await em.execute(
      `SELECT id, invoice_number, status, currency_code, issue_date, due_date,
              subtotal_net_amount, grand_total_net_amount, grand_total_gross_amount,
              paid_total_amount, outstanding_amount, metadata, created_at, updated_at
       FROM sales_invoices
       WHERE ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, query.pageSize, offset],
    )) as unknown as BillingInvoiceRow[]

    return NextResponse.json({
      items: itemRows,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 1 : Math.ceil(total / query.pageSize),
    })
  } catch (err) {
    console.error('[billing/invoices.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'List billing-managed invoices',
      description:
        'Returns a paginated list of `core/sales` invoices that the ' +
        'billing engine emitted (matched via `metadata->>\'bill_run_id\'` ' +
        'presence). Supports status / billRunId / billAccountId / testRun ' +
        '/ invoice_number search filters.',
    },
  },
}
