import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { BillingAccount } from '../../../../data/entities'
import { getCreditSnapshot } from '../../../../lib/accountStatus'

/**
 * `GET /api/billing/accounts/[id]/credit-status` — credit limit / used /
 * available / status for BOTH modes (SPEC-002 P6). Report-only — billing never
 * blocks; the quote→order flow (e.g. a CPQ credit guard) decides what to do.
 *
 *   - prepaid:  credit_used = max(0, −balance)
 *   - postpaid: credit_used = Σ posted-unpaid invoice outstanding (core/sales)
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.credit.view'] },
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

    const snapshot = await getCreditSnapshot(em, account)
    return NextResponse.json(snapshot)
  } catch (err) {
    console.error('[billing/accounts/credit-status.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      tags: ['Billing'],
      summary: 'Get an account credit status (both modes)',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      description:
        'Returns `{ mode, creditLimit, creditUsed, availableCredit, creditStatus, ' +
        'currencyCode }`. Prepaid creditUsed = max(0,−balance); postpaid = Σ ' +
        'posted-unpaid invoice outstanding. Report-only — billing never blocks.',
    },
  },
}
