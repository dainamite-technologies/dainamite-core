import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqOfferingComponentCreateSchema, cpqOfferingComponentUpdateSchema } from '../../data/validators'
import type { DefaultCpqBundleService } from '../../services/cpqBundleService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.offerings.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.offerings.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqOfferingComponentCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqBundleService') as DefaultCpqBundleService

    const component = await service.addComponent(body, scope)
    return NextResponse.json(component, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (err instanceof Error && err.message.startsWith('V-')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[cpq/offering-components.POST]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
