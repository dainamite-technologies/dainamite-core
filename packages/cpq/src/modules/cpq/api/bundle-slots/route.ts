import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../context'
import { cpqBundleSlotCreateSchema, cpqBundleSlotUpdateSchema } from '../../data/validators'
import type { DefaultCpqBundleService } from '../../services/cpqBundleService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqDeleteByIdBody, cpqSuccessResponseSchema } from '../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.specifications.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const id = url.searchParams.get('id')
    if (id) {
      const slot = await service.getSlot(id, scope)
      if (!slot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(slot)
    }

    const specId = url.searchParams.get('specId')
    if (!specId) return NextResponse.json({ error: 'specId is required' }, { status: 400 })

    const slots = await service.getSlots(specId, scope)
    return NextResponse.json({ items: slots })
  } catch (err) {
    console.error('[cpq/bundle-slots.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqBundleSlotCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const slot = await service.createSlot(body, scope)
    return NextResponse.json(slot, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (err instanceof Error && err.message.startsWith('V-')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[cpq/bundle-slots.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqBundleSlotUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const slot = await service.updateSlot(id, updates, scope)
    if (!slot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json(slot)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (err instanceof Error && err.message.startsWith('V-')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[cpq/bundle-slots.PUT]', err)
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

    const deleted = await service.deleteSlot(id, scope)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message.includes('active offering components')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[cpq/bundle-slots.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Bundles',
  summary: 'CPQ bundle slots',
  methods: {
    GET: {
      summary: 'List the slots of a bundle specification, or get one slot by id',
      description: 'With `id` returns a single slot; otherwise `specId` is required.',
      query: z.object({ id: z.string().uuid().optional(), specId: z.string().uuid().optional() }),
      responses: [{ status: 200, description: 'Slot, or `{ items }` slots of the specification' }],
      errors: [
        cpqErrorDoc(400, 'specId is required'),
        cpqErrorDoc(404, 'Slot not found'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    POST: {
      summary: 'Create a slot on a bundle specification',
      requestBody: { schema: cpqBundleSlotCreateSchema },
      responses: [{ status: 201, description: 'Created slot' }],
      errors: [
        cpqErrorDoc(400, 'Validation error or bundle rule violation (`V-*` code)'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    PUT: {
      summary: 'Update a bundle slot',
      requestBody: { schema: cpqBundleSlotUpdateSchema },
      responses: [{ status: 200, description: 'Updated slot' }],
      errors: [
        cpqErrorDoc(400, 'Validation error or bundle rule violation (`V-*` code)'),
        cpqErrorDoc(404, 'Slot not found'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    DELETE: {
      summary: 'Delete a bundle slot',
      description: 'Refused while active offering components still use the slot.',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: [
        cpqErrorDoc(400, 'Missing id, or the slot still has active offering components'),
        cpqErrorDoc(404, 'Slot not found'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
