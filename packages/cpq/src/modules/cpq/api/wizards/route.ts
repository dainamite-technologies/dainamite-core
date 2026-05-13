import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqWizardDefinitionCreateSchema, cpqWizardDefinitionUpdateSchema } from '../../data/validators'
import { DefaultCpqWizardService } from '../../services/cpqWizardService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.wizards.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.wizards.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.wizards.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.wizards.manage'] },
}

function resolveWizardService(ctx: { em: import('@mikro-orm/postgresql').EntityManager }) {
  return new DefaultCpqWizardService(ctx.em)
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveWizardService(ctx)

    // Detail view
    const id = url.searchParams.get('id')
    const code = url.searchParams.get('code')
    if (id || code) {
      const result = await service.getDefinition((id ?? code)!, scope)
      if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(result)
    }

    // List view
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))
    const surface = url.searchParams.get('surface') ?? undefined
    const isActiveParam = url.searchParams.get('isActive')
    const isActive = isActiveParam !== null ? isActiveParam === 'true' : undefined
    const search = url.searchParams.get('search') ?? undefined

    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'code', 'surface'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    const sortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)
      ? (sortFieldParam as (typeof ALLOWED_SORT_FIELDS)[number])
      : undefined
    const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    return NextResponse.json(
      await service.listDefinitions(
        { surface, isActive, search, sortField, sortDir },
        scope,
        page,
        pageSize,
      ),
    )
  } catch (err) {
    console.error('[cpq/wizards.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqWizardDefinitionCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveWizardService(ctx)

    const result = await service.createDefinition(body, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/wizards.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqWizardDefinitionUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveWizardService(ctx)

    const result = await service.updateDefinition(id, updates, scope)
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/wizards.PUT]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = (await req.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = resolveWizardService(ctx)

    const deleted = await service.deleteDefinition(id, scope)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/wizards.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
