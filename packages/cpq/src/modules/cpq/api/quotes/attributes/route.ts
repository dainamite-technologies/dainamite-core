import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../context'
import { DefaultCpqProductService } from '../../../services/cpqProductService'
import { CpqProductOffering } from '../../../data/entities'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const url = new URL(req.url)
    const offeringId = url.searchParams.get('offeringId')
    const productId = url.searchParams.get('productId')
    const configParam = url.searchParams.get('configuration')

    if (!offeringId && !productId) {
      return NextResponse.json({ error: 'Either offeringId or productId is required' }, { status: 400 })
    }

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    let currentConfig: Record<string, unknown> = {}
    if (configParam) {
      try {
        currentConfig = JSON.parse(configParam) as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: 'Invalid configuration JSON' }, { status: 400 })
      }
    }

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quote attributes',
  methods: {
    GET: {
      summary: 'List run-time attributes to configure for an offering',
      description:
        "Returns the offering specification's run-time attributes with constraints applied against the current configuration. Requests with only `productId` (legacy) return an empty list.",
      query: z.object({
        offeringId: z.string().uuid().optional(),
        productId: z.string().uuid().optional(),
        configuration: z
          .string()
          .optional()
          .describe('JSON-encoded object of the attribute values selected so far'),
      }),
      responses: [{ status: 200, description: '`{ attributes }`' }],
      errors: [
        cpqErrorDoc(400, 'Either offeringId or productId is required'),
        cpqErrorDoc(404, 'Offering not found'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
