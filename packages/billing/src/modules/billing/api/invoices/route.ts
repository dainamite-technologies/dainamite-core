import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { billingInvoiceListQuerySchema } from '../../data/validators'
import { daysOverdueSql, isoDay, overdueSql } from '../../lib/overdue'

/**
 * `GET /api/billing/invoices` — paginated list of billing documents
 * (Spec 0: billing-owned `billing_invoices`, never core `sales`).
 *
 * Filters (all on indexed columns): `status`, `documentType`, `billRunId`,
 * `billAccountId`, `testRun` (`true` / `false`), `id`, `search` (number).
 * Spec B: `overdue=true` (computed, B-D6 — see `lib/overdue.ts`), `dueFrom` /
 * `dueTo` (due-date window). Each row carries `bill_account_name` (joined)
 * and `days_overdue` (0 when not overdue).
 *
 * Hand-written SQL instead of the CRUD factory: documents are written by the
 * bill-run engine without query-index side effects, so the factory's
 * query-engine path would not see them. Sort: `created_at DESC`.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.invoice.view'] },
}

type BillingInvoiceRow = {
  id: string
  number: string
  document_type: string
  status: string
  test_run: boolean
  bill_account_id: string
  bill_account_name: string | null
  bill_run_id: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  issue_date: string | null
  due_date: string | null
  currency_code: string
  subtotal_net: string
  tax_total: string
  total_gross: string
  paid_total: string
  credited_total: string
  outstanding: string
  days_overdue: number
  corrects_invoice_id: string | null
  topup_id: string | null
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
    const query = billingInvoiceListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))

    const em = (container.resolve('em') as EntityManager).fork()

    const whereClauses: string[] = ['i.tenant_id = ?', 'i.organization_id = ?', 'i.deleted_at IS NULL']
    const params: unknown[] = [auth.tenantId, organizationId]
    const filters: Array<[unknown, string]> = [
      [query.id, 'i.id = ?'],
      [query.status, 'i.status = ?'],
      [query.documentType, 'i.document_type = ?'],
      [query.billRunId, 'i.bill_run_id = ?'],
      [query.billAccountId, 'i.bill_account_id = ?'],
      [query.testRun, 'i.test_run = ?'],
    ]
    for (const [value, clause] of filters) {
      if (value === undefined || value === null || value === '') continue
      whereClauses.push(clause)
      params.push(value)
    }
    const today = isoDay(new Date())
    if (query.overdue === true) {
      whereClauses.push(overdueSql('i'))
      params.push(today)
    } else if (query.overdue === false) {
      whereClauses.push(`NOT COALESCE(${overdueSql("i")}, false)`)
      params.push(today)
    }
    if (query.dueFrom) {
      whereClauses.push('i.due_date >= ?::date')
      params.push(query.dueFrom)
    }
    if (query.dueTo) {
      whereClauses.push('i.due_date <= ?::date')
      params.push(query.dueTo)
    }
    if (query.search) {
      whereClauses.push('i.number ILIKE ?')
      params.push(`%${query.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)
    }

    const whereSql = whereClauses.join(' AND ')
    const countRows = (await em.execute(
      `SELECT COUNT(*)::int AS total FROM billing_invoices i WHERE ${whereSql}`,
      params,
    )) as unknown as Array<{ total: number }>
    const total = countRows?.[0]?.total ?? 0

    const offset = (query.page - 1) * query.pageSize
    const itemRows = (await em.execute(
      `SELECT i.id, i.number, i.document_type, i.status, i.test_run, i.bill_account_id,
              a.name AS bill_account_name, i.bill_run_id, i.bill_date, i.period_start, i.period_end,
              i.issue_date, i.due_date, i.currency_code, i.subtotal_net, i.tax_total, i.total_gross,
              i.paid_total, i.credited_total, i.outstanding, i.corrects_invoice_id, i.topup_id,
              ${daysOverdueSql('i')}::int AS days_overdue,
              i.created_at, i.updated_at
       FROM billing_invoices i
       LEFT JOIN billing_accounts a ON a.id = i.bill_account_id AND a.tenant_id = i.tenant_id
       WHERE ${whereSql}
       ORDER BY i.created_at DESC
       LIMIT ? OFFSET ?`,
      [today, today, ...params, query.pageSize, offset],
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
      summary: 'List billing documents',
      description:
        'Paginated billing documents (invoices, credit / debit memos, top-up receipts) from ' +
        '`billing_invoices`. Filters: status, documentType, billRunId, billAccountId, testRun ' +
        '(`true`/`false`), id, number search, `overdue` (`true`/`false` — posted or partially paid, ' +
        'past due, outstanding > 0), `dueFrom` / `dueTo` (YYYY-MM-DD). Each row adds `days_overdue`. ' +
        'Fields use billing names: `number`, `document_type`, ' +
        '`total_gross`, `outstanding`, `bill_date`, `period_start/end`, `bill_account_name`, … ' +
        '(0.21.0 renamed them from the core-sales names — see MIGRATION.md).',
    },
  },
}
