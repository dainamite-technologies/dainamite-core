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

    const [items, usage, outcomes] = await Promise.all([
      em.find(BillingItem, {
        tenantId,
        organizationId,
        billAccountId: account.id,
      } as never),
      em.find(BillingAccountUsage, {
        tenantId,
        organizationId,
        billAccountId: account.id,
      } as never),
      em.find(BillRunOutcome, {
        tenantId,
        organizationId,
        billAccountId: account.id,
      } as never),
    ])

    // Invoices that the engine emitted for this account live in
    // `core/sales` with `metadata->>'bill_account_id'` set. Query
    // directly — the row counts are bounded by the account's bill
    // history (cycles + retries), so a single raw select is fine.
    const invoiceRows = (await em.execute(
      `SELECT id, invoice_number, status, status_entry_id, issue_date, due_date,
              currency_code, subtotal_net_amount, grand_total_net_amount,
              grand_total_gross_amount, paid_total_amount, outstanding_amount,
              metadata, created_at, updated_at, deleted_at
       FROM sales_invoices
       WHERE tenant_id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
         AND metadata->>'bill_account_id' = ?`,
      [tenantId, organizationId, account.id],
    )) as unknown as Array<{ id: string }>

    const invoiceIds = invoiceRows.map((r) => r.id)
    const draftEdits =
      invoiceIds.length > 0
        ? await em.find(DraftInvoiceEdit, {
            tenantId,
            organizationId,
            invoiceId: { $in: invoiceIds },
          } as never)
        : []

    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      tenantId,
      organizationId,
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

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Export a billing account (GDPR portability)',
      description:
        'Returns a JSON dump of a single Billing Account: the account itself, every Billing Item, every Usage record, every BillRunOutcome, every emitted invoice (from `core/sales` matched via `metadata`), and every draft-edit audit row. Tenant- + organization-scoped via the caller\'s auth context.',
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
