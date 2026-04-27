import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../context'
import { DefaultCpqValidationService } from '../../services/cpqValidationService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

/**
 * Returns resolved options for an attribute, including dynamic options from
 * pricing tables (e.g. cloud_region filtered by cloud_provider).
 * Used by the quoting wizard to render picklists for attributes with
 * dynamicOptionsSource or dependsOn constraints.
 */
export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const productId = url.searchParams.get('productId')
    const attributeCode = url.searchParams.get('attributeCode')
    const configParam = url.searchParams.get('configuration')

    if (!productId || !attributeCode) {
      return NextResponse.json(
        { error: 'productId and attributeCode are required' },
        { status: 400 },
      )
    }

    let configuration: Record<string, unknown> = {}
    if (configParam) {
      try {
        configuration = JSON.parse(configParam) as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: 'Invalid configuration JSON' }, { status: 400 })
      }
    }

    const validationService = new DefaultCpqValidationService(ctx.em)
    const options = await validationService.getAttributeOptions({
      productId,
      attributeCode,
      currentConfiguration: configuration,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    return NextResponse.json({ items: options })
  } catch (err) {
    console.error('[cpq/attribute-options.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
