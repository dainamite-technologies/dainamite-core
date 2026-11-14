import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { BillingAccount } from '../../../../data/entities'
import { getAccountArSummary } from '../../../../lib/accountSummary'

/**
 * `GET /api/billing/accounts/[id]/summary` — what the customer owes (Spec B
 * AR summary; Spec E extends the same endpoint for the account workspace).
 * One aggregate query; see `lib/accountSummary.ts`.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.account.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const organizationId = (auth as { orgId?: string }).orgId ?? null
    if (!organizationId) {
      return NextResponse.json({ error: 'Organization scope required' }, { status: 403 })
    }
    const { id: accountId } = await params
    const em = (container.resolve('em') as EntityManager).fork()
    const account = await em.findOne(BillingAccount, {
      id: accountId,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    return NextResponse.json(await getAccountArSummary(em, account))
  } catch (err) {
    console.error('[billing/accounts/summary.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Get a billing account receivables summary',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      description:
        'Returns `{ bill_account_id, currency_code, open_amount, overdue_amount, overdue_count, ' +
        'credit_amount }` over posted / partially paid invoices and debit memos (test runs excluded). ' +
        'Overdue = past due date with outstanding > 0. `credit_amount` is 0 until payments (Spec C).',
    },
  },
}
