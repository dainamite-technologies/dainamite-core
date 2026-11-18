import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { cpqOfferingComponentCreateSchema, cpqOfferingComponentUpdateSchema } from '../../data/validators'
import type { DefaultCpqBundleService } from '../../services/cpqBundleService'
import { bundleErrorResponse } from '../_helpers/bundleErrors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqDeleteByIdBody, cpqSuccessResponseSchema, CPQ_CRUD_BY_ID_ERRORS } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.offerings.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const offeringId = url.searchParams.get('offeringId')
    if (!offeringId) return NextResponse.json({ error: 'offeringId is required' }, { status: 400 })

    const components = await service.getComponents(offeringId, scope)

    const slotId = url.searchParams.get('slotId')
    const filtered = slotId ? components.filter((c) => c.slotId === slotId) : components

    return NextResponse.json({ items: filtered })
  } catch (err) {
    console.error('[cpq/offering-components.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqOfferingComponentCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const component = await service.addComponent(body, scope)
    return NextResponse.json(component, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    const mapped = bundleErrorResponse(err)
    if (mapped) return mapped
    console.error('[cpq/offering-components.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqOfferingComponentUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const component = await service.updateComponent(id, updates, scope)
    if (!component) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json(component)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/offering-components.PUT]', err)
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
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const deleted = await service.removeComponent(id, scope)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/offering-components.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Bundles',
  summary: 'CPQ offering components',
  methods: {
    GET: {
      summary: 'List the components (child offerings per slot) of a bundle offering',
      query: z.object({ offeringId: z.string().uuid(), slotId: z.string().uuid().optional() }),
      responses: [{ status: 200, description: '`{ items }` components of the offering' }],
      errors: [cpqErrorDoc(400, 'offeringId is required'), cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Add a child offering to a slot of a bundle offering',
      requestBody: { schema: cpqOfferingComponentCreateSchema },
      description:
        'A removed (soft-deleted) component does not block adding the same child offering again; V-COMP-5 applies to live components only.',
      responses: [{ status: 201, description: 'Created component' }],
      errors: [
        cpqErrorDoc(400, 'Validation error or bundle rule violation (`V-*` code)'),
        cpqErrorDoc(404, 'Offering, slot or child offering not found'),
        cpqErrorDoc(409, 'V-COMP-5: the child offering was added concurrently'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    PUT: {
      summary: 'Update a bundle offering component',
      requestBody: { schema: cpqOfferingComponentUpdateSchema },
      responses: [{ status: 200, description: 'Updated component' }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
    DELETE: {
      summary: 'Remove a component from a bundle offering',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Removed', schema: cpqSuccessResponseSchema }],
      errors: CPQ_CRUD_BY_ID_ERRORS,
    },
  },
}
