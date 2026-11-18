import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../context'
import { DefaultCpqWizardService } from '../../../services/cpqWizardService'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.wizards.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const url = new URL(req.url)
    const surface = url.searchParams.get('surface')
    if (!surface || !['backend', 'portal'].includes(surface)) {
      return NextResponse.json({ error: 'Missing or invalid surface parameter' }, { status: 400 })
    }

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = new DefaultCpqWizardService(ctx.em)

    const result = await service.resolveWizard(
      {
        surface: surface as 'backend' | 'portal',
        specCode: url.searchParams.get('specCode') ?? undefined,
        offeringCode: url.searchParams.get('offeringCode') ?? undefined,
        customerSegment: url.searchParams.get('customerSegment') ?? undefined,
      },
      scope,
    )

    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cpq/wizards/resolve.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Wizards',
  summary: 'CPQ wizard resolution',
  methods: {
    GET: {
      summary: 'Resolve which wizard definition applies to a quoting context',
      description: 'Picks the best-matching active wizard for the surface and optional specification, offering and customer segment.',
      query: z.object({
        surface: z.enum(['backend', 'portal']),
        specCode: z.string().optional(),
        offeringCode: z.string().optional(),
        customerSegment: z.string().optional(),
      }),
      responses: [{ status: 200, description: 'Resolved wizard definition' }],
      errors: [
        cpqErrorDoc(400, 'Missing or invalid surface parameter'),
        cpqErrorDoc(404, 'No matching wizard'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
