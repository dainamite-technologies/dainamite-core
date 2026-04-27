import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../context'
import { DefaultCpqWizardService } from '../../../services/cpqWizardService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.wizards.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
