import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { CpqProductRelationship } from '../../data/entities'
import { cpqProductRelationshipCreateSchema, cpqProductRelationshipUpdateSchema } from '../../data/validators'

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
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const filters: Record<string, unknown> = { ...scope }
    const sourceSpecId = url.searchParams.get('sourceSpecId')
    if (sourceSpecId) filters.sourceSpecId = sourceSpecId
    const targetSpecId = url.searchParams.get('targetSpecId')
    if (targetSpecId) filters.targetSpecId = targetSpecId
    const relationshipType = url.searchParams.get('relationshipType')
    if (relationshipType) filters.relationshipType = relationshipType

    const [items, total] = await ctx.em.findAndCount(CpqProductRelationship, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        sourceSpecId: item.sourceSpecId,
        targetSpecId: item.targetSpecId,
        relationshipType: item.relationshipType,
        cardinalityMin: item.cardinalityMin,
        cardinalityMax: item.cardinalityMax,
        condition: item.condition,
        metadata: item.metadata,
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    console.error('[cpq/product-relationships.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductRelationshipCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const entity = ctx.em.create(CpqProductRelationship, { ...body, ...scope })
    await ctx.em.flush()

    return NextResponse.json(
      {
        id: entity.id,
        sourceSpecId: entity.sourceSpecId,
        targetSpecId: entity.targetSpecId,
        relationshipType: entity.relationshipType,
        cardinalityMin: entity.cardinalityMin,
        cardinalityMax: entity.cardinalityMax,
        condition: entity.condition,
        metadata: entity.metadata,
        isActive: entity.isActive,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/product-relationships.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqProductRelationshipUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqProductRelationship, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    ctx.em.assign(entity, updates)
    await ctx.em.flush()

    return NextResponse.json({
      id: entity.id,
      sourceSpecId: entity.sourceSpecId,
      targetSpecId: entity.targetSpecId,
      relationshipType: entity.relationshipType,
      cardinalityMin: entity.cardinalityMin,
      cardinalityMax: entity.cardinalityMax,
      condition: entity.condition,
      metadata: entity.metadata,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/product-relationships.PUT]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = (await req.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }
    const entity = await ctx.em.findOne(CpqProductRelationship, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/product-relationships.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
