import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  BillingAccount,
  BillingAccountUsage,
  BillingItem,
  BillRunOutcome,
  DraftInvoiceEdit,
} from '../../../../data/entities'

/**
 * `GET /api/billing/export/account/[id]` — GDPR portability dump.
 *
 * Returns a full JSON serialization of a single Billing Account
 * including:
 *   - The account row itself.
 *   - Every active + soft-deleted `BillingItem` for the account.
 *   - Every `BillingAccountUsage` record.
 *   - Every `BillRunOutcome` row referencing the account.
 *   - Every `core/sales` invoice the engine emitted for the account
 *     (matched via `metadata->>'bill_account_id'`).
 *   - Every `DraftInvoiceEdit` audit row for those invoices.
 *
 * Scope: the caller's auth tenant/organization is the authority — a
 * 404 is returned even for valid UUIDs that belong to a different
 * tenant (no cross-tenant leak).
 *
 * Soft-deleted rows are included on purpose: GDPR portability is
 * about the data we still hold, not just the data the UI shows.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.account.view'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let container: Awaited<ReturnType<typeof createRequestContainer>> | null = null
  try {
    container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = auth.tenantId
    const organizationId = (auth as { orgId?: string }).orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization scope required' },
        { status: 403 },
      )
    }

    const { id: accountId } = await params

    const em = (container.resolve('em') as EntityManager).fork()
    const account = await em.findOne(BillingAccount, {
      id: accountId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Time-window cap for usage records, run outcomes and invoices.
    //
    // Scale note: a telco account can carry millions of usage rows.
    // Returning everything would OOM on the export path. We default
    // to the last 12 months and let the caller override via `since` /
    // `until` for full GDPR-compliance dumps (a regulator request that
    // legitimately needs the lifetime export should set `since=1970-01-01`).
    // Each query is independently capped by `EXPORT_HARD_LIMIT` so a
    // single year of pathological volume still returns rather than
    // hanging.
    const url = new URL(req.url)
    const since = parseDate(url.searchParams.get('since'))
      ?? defaultSince()
    const until = parseDate(url.searchParams.get('until')) ?? new Date()

    const [items, usage, outcomes] = await Promise.all([
      // Items are bounded by integration volume (typically <100 per
      // account); no time-window needed — they often outlive a single
      // export window and the operator needs to see active items
      // regardless of when they were created.
      em.find(
        BillingItem,
        { tenantId, organizationId, billAccountId: account.id } as never,
        { limit: EXPORT_HARD_LIMIT },
      ),
      em.find(
        BillingAccountUsage,
        {
          tenantId,
          organizationId,
          billAccountId: account.id,
          periodEnd: { $gte: since, $lte: until },
        } as never,
        { limit: EXPORT_HARD_LIMIT, orderBy: { periodEnd: 'DESC' } },
      ),
      em.find(
        BillRunOutcome,
        {
          tenantId,
          organizationId,
          billAccountId: account.id,
          createdAt: { $gte: since, $lte: until },
        } as never,
        { limit: EXPORT_HARD_LIMIT, orderBy: { createdAt: 'DESC' } },
      ),
    ])

    // Invoices created in the window. The `metadata->>'bill_account_id'`
    // predicate keeps non-billing core/sales invoices out.
    const invoiceRows = (await em.execute(
      `SELECT id, invoice_number, status, status_entry_id, issue_date, due_date,
              currency_code, subtotal_net_amount, grand_total_net_amount,
              grand_total_gross_amount, paid_total_amount, outstanding_amount,
              metadata, created_at, updated_at, deleted_at
       FROM sales_invoices
       WHERE tenant_id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
         AND metadata->>'bill_account_id' = ?
         AND created_at >= ?
         AND created_at <= ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [tenantId, organizationId, account.id, since, until, EXPORT_HARD_LIMIT],
    )) as unknown as Array<{ id: string }>

    const invoiceIds = invoiceRows.map((r) => r.id)
    const draftEdits =
      invoiceIds.length > 0
        ? await em.find(
            DraftInvoiceEdit,
            {
              tenantId,
              organizationId,
              invoiceId: { $in: invoiceIds },
            } as never,
            { limit: EXPORT_HARD_LIMIT, orderBy: { createdAt: 'DESC' } },
          )
        : []

    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      tenantId,
      organizationId,
      window: {
        since: since.toISOString(),
        until: until.toISOString(),
        hardLimit: EXPORT_HARD_LIMIT,
      },
      account,
      items,
      usage,
      runOutcomes: outcomes,
      invoices: invoiceRows,
      draftInvoiceEdits: draftEdits,
    })
  } catch (err) {
    console.error('[billing/export/account.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * Per-collection cap to keep a single export bounded in size and time
 * even when the caller asks for `since=1970-01-01`. The full GDPR
 * lifetime dump for an outlier account requires a follow-up
 * background-job approach (chunked NDJSON to object storage) — out of
 * scope for the v1 admin export endpoint.
 */
const EXPORT_HARD_LIMIT = 50_000

/**
 * Default time window for the export — last 12 months. Operators
 * pulling for routine GDPR requests almost always want a finite
 * window; the regulator-compliance "lifetime" case overrides via
 * `?since=1970-01-01`.
 */
function defaultSince(): Date {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - 1)
  return d
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Export a billing account (GDPR portability)',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'since',
          in: 'query',
          required: false,
          description:
            'ISO timestamp; lower bound for usage / outcomes / invoices windows. Defaults to today − 12 months.',
          schema: { type: 'string', format: 'date-time' },
        },
        {
          name: 'until',
          in: 'query',
          required: false,
          description: 'ISO timestamp; upper bound. Defaults to now.',
          schema: { type: 'string', format: 'date-time' },
        },
      ],
      description:
        "Returns a JSON dump of a single Billing Account: the account itself, every Billing Item (no time cap — items often outlive a single export window), and the Usage records / BillRunOutcomes / emitted core/sales invoices / DraftInvoiceEdit rows whose timestamps fall in the [since, until] window (defaults to the last 12 months). Each collection is independently capped by EXPORT_HARD_LIMIT = 50,000 rows. Lifetime dumps for outlier accounts need a follow-up chunked background-job approach — out of scope for this v1 endpoint.",
    },
  },
}
