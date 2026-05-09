import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../context'
import { cpqInventoryStatusTransitionSchema } from '../../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventoryStatusTransitionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.transitionSubscriptionStatus(body.id, body.targetStatus, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (err && typeof err === 'object' && 'status' in err && (err as any).status === 409) {
      return NextResponse.json(
        { error: (err as any).error ?? 'Conflict' },
        { status: 409 },
      )
    }
    console.error('[cpq/inventory/subscriptions/status.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
