import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../context'
import { DefaultCpqProductService } from '../../../services/cpqProductService'
import { CpqProductOffering } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const offeringId = url.searchParams.get('offeringId')
    const productId = url.searchParams.get('productId')
    const configParam = url.searchParams.get('configuration')

    if (!offeringId && !productId) {
      return NextResponse.json({ error: 'Either offeringId or productId is required' }, { status: 400 })
    }

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const currentConfig = configParam ? JSON.parse(configParam) : {}

    // Use ctx.em directly to avoid DI scope issues
    const productService = new DefaultCpqProductService(ctx.em)

    let specId: string | undefined
    if (offeringId) {
      const offering = await ctx.em.findOne(CpqProductOffering, {
        id: offeringId,
        ...scope,
        deletedAt: null,
      })
      if (!offering) return NextResponse.json({ error: 'Offering not found' }, { status: 404 })
      specId = offering.specId
    }

    if (specId) {
      const attributes = await productService.getConstrainedAttributes({
        specId,
        ...scope,
        currentConfig,
        offeringId: offeringId ?? undefined,
      })

      // Filter to run-time attributes only
      const runTimeAttrs = attributes.filter((a) => a.resolutionTime === 'run_time')

      return NextResponse.json({ attributes: runTimeAttrs })
    }

    // v1 fallback: productId-based
    return NextResponse.json({ attributes: [] })
  } catch (err) {
    console.error('[cpq/quotes/attributes.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
