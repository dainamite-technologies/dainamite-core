import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { DefaultCpqValidationService } from '../../services/cpqValidationService'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ attribute options',
  methods: {
    GET: {
      summary: 'Resolve picklist options for a product attribute',
      description:
        'Used by the quoting wizard. Returns the options of one attribute, including dynamic options sourced from pricing tables and options narrowed by `dependsOn` constraints against the current configuration.',
      query: z.object({
        productId: z.string(),
        attributeCode: z.string(),
        configuration: z
          .string()
          .optional()
          .describe('JSON-encoded object of the attribute values selected so far'),
      }),
      responses: [{ status: 200, description: '`{ items }` resolved options' }],
      errors: [
        cpqErrorDoc(400, 'productId and attributeCode are required, or configuration is not valid JSON'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
