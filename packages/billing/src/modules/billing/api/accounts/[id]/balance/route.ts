import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { BillingAccount } from '../../../../data/entities'
import { getBalanceSnapshot } from '../../../../lib/accountStatus'

/**
 * `GET /api/billing/accounts/[id]/balance` — current prepaid balance, status,
 * and resolved low-balance threshold (SPEC-002). Read-only.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.balance.view'] },
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
    if (account.billingMode !== 'prepaid') {
      return NextResponse.json(
        { error: 'Account is not prepaid', code: 'billing.account.not_prepaid' },
        { status: 409 },
      )
    }

    const snapshot = await getBalanceSnapshot(em, account)
    return NextResponse.json(snapshot)
  } catch (err) {
    console.error('[billing/accounts/balance.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Get a prepaid account balance + status',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      description:
        'Returns the current running balance, `balanceStatus` (ok/low/exhausted), ' +
        'the resolved low-balance threshold, the currency, and the last-movement ' +
        'timestamp for a prepaid account. 409 (`billing.account.not_prepaid`) for ' +
        'postpaid accounts.',
    },
  },
}
