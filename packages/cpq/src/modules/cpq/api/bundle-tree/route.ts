import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../context'
import type { DefaultCpqBundleService } from '../../services/cpqBundleService'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Bundles',
  summary: 'CPQ bundle tree',
  methods: {
    GET: {
      summary: 'Resolve the slot/component tree of a bundle offering',
      description:
        'Returns the resolved bundle tree (slots with their component offerings) for a bundle offering, plus a completeness validation result (cardinality checks per slot).',
      query: z.object({ offeringId: z.string().uuid() }),
      responses: [{ status: 200, description: '`{ tree, validation }` for the offering' }],
      errors: [
        cpqErrorDoc(400, 'offeringId is required'),
        cpqErrorDoc(404, 'Offering not found'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
