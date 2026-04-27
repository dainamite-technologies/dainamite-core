import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../context'
import type { DefaultCpqBundleService } from '../../services/cpqBundleService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.offerings.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const offeringId = url.searchParams.get('offeringId')
    if (!offeringId) return NextResponse.json({ error: 'offeringId is required' }, { status: 400 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const tree = await service.resolveBundleTree(offeringId, scope)
    if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const validation = await service.validateBundleCompleteness(offeringId, scope)

    return NextResponse.json({ tree, validation })
  } catch (err) {
    console.error('[cpq/bundle-tree.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
