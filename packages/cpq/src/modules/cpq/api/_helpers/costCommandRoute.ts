import { NextResponse } from 'next/server'
import type { CpqRouteContext } from '../context'
import type { CpqCostService } from '../../services/costs/costService'

/** `404` while the tenant toggle `cpq.cost_plus` is off (feature spec Q8). */
export const costToggleOff = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function costPlusEnabled(ctx: CpqRouteContext): Promise<boolean> {
  return ctx.container.resolve<CpqCostService>('cpqCostService').enabled(ctx.tenantId)
}
