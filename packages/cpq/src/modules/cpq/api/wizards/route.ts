import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { cpqWizardDefinitionCreateSchema, cpqWizardDefinitionUpdateSchema } from '../../data/validators'
import { DefaultCpqWizardService } from '../../services/cpqWizardService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqSortDirQuery, cpqDeleteByIdBody, cpqSuccessResponseSchema, CPQ_CRUD_WRITE_ERRORS, CPQ_CRUD_BY_ID_ERRORS } from '../_helpers/quoteRouteOpenApi'

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Wizards',
  summary: 'CPQ wizard definitions',
  methods: {
    GET: {
      summary: 'List CPQ quoting wizard definitions, or get one by id or code',
      description: 'With `id` or `code` returns a single definition; otherwise a paged list.',
      query: cpqPaginationQuery.extend({
        id: z.string().optional(),
        code: z.string().optional(),
        surface: z.string().optional(),
        isActive: z.enum(['true', 'false']).optional(),
        search: z.string().optional(),
        sortField: z.enum(['createdAt', 'updatedAt', 'name', 'code', 'surface']).optional(),
        sortDir: cpqSortDirQuery,
      }),
      responses: [{ status: 200, description: 'Wizard definition, or paged list of definitions' }],
      errors: [cpqErrorDoc(404, 'Wizard definition not found'), cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Create a CPQ wizard definition',
      requestBody: { schema: cpqWizardDefinitionCreateSchema },
      responses: [{ status: 201, description: 'Created wizard definition' }],
      errors: CPQ_CRUD_WRITE_ERRORS,
    },
    PUT: {
      summary: 'Update a CPQ wizard definition',
      requestBody: { schema: cpqWizardDefinitionUpdateSchema },
      responses: [{ status: 200, description: 'Updated wizard definition' }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
    DELETE: {
      summary: 'Delete a CPQ wizard definition',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
  },
}
