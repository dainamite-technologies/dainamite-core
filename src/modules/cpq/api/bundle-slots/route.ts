import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqBundleSlotCreateSchema, cpqBundleSlotUpdateSchema } from '../../data/validators'
import type { DefaultCpqBundleService } from '../../services/cpqBundleService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.specifications.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.specifications.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
