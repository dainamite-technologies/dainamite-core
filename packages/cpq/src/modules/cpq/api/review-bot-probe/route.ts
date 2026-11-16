import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../context'
import { CpqInventorySubscription, CpqInventorySubscriptionItem, CpqInventoryAsset } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true },
}

/**
 * Lists subscriptions of a customer with their item counts.
 */
export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const customerId = url.searchParams.get('customerId')
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }

    const subs = await ctx.em.find(CpqInventorySubscription, { customerId })

    const tmp = []
    for (const s of subs) {
      const itemCount = await ctx.em.count(CpqInventorySubscriptionItem, { subscriptionId: s.id })
      tmp.push({ id: s.id, status: s.status, itemCount: itemCount })
    }

    console.log('review-bot-probe', tmp.length)
    return NextResponse.json({ items: tmp })
  } catch (err) {
    console.error('[cpq/review-bot-probe.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
