import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { CpqPriceRule, CpqProductOffering } from '../../data/entities'
import { cpqPriceRuleCreateSchema, cpqPriceRuleUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.pricing.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.pricing.manage'] },
}

function serializeRule(rule: CpqPriceRule) {
  return {
    id: rule.id,
    code: rule.code,
    name: rule.name,
    description: rule.description ?? null,
    productOfferingId: rule.productOfferingId ?? null,
    ruleType: rule.ruleType,
    value: Number(rule.value),
    chargeCodeFilter: rule.chargeCodeFilter ?? null,
    chargeTypeFilter: rule.chargeTypeFilter ?? null,
    applicabilityCondition: rule.applicabilityCondition ?? null,
    sortOrder: rule.sortOrder,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const id = url.searchParams.get('id')
    if (id) {
      const item = await ctx.em.findOne(CpqPriceRule, { id, ...scope })
      if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(serializeRule(item))
    }

    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))

    const filters: Record<string, unknown> = { ...scope }

    const productOfferingId = url.searchParams.get('productOfferingId')
    if (productOfferingId) {
      filters.productOfferingId = productOfferingId
    }

    const globalOnly = url.searchParams.get('globalOnly')
    if (globalOnly === 'true' && !productOfferingId) {
      filters.productOfferingId = null
    }

    const ruleType = url.searchParams.get('ruleType')
    if (ruleType) filters.ruleType = ruleType

    const chargeTypeFilter = url.searchParams.get('chargeTypeFilter')
    if (chargeTypeFilter) filters.chargeTypeFilter = chargeTypeFilter

    const isActiveParam = url.searchParams.get('isActive')
    if (isActiveParam === 'true') filters.isActive = true
    else if (isActiveParam === 'false') filters.isActive = false

    // Free-text search across code, name, description (case-insensitive)
    const search = url.searchParams.get('search')?.trim()
    if (search) {
      filters.$or = [
        { code: { $ilike: `%${search}%` } },
        { name: { $ilike: `%${search}%` } },
        { description: { $ilike: `%${search}%` } },
      ]
    }

    // Configurable sort
    const ALLOWED_SORT_FIELDS = ['sortOrder', 'createdAt', 'updatedAt', 'code', 'name', 'ruleType'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    const sortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)
      ? (sortFieldParam as (typeof ALLOWED_SORT_FIELDS)[number])
      : 'sortOrder'
    const sortDir = url.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc'

    const [items, total] = await ctx.em.findAndCount(CpqPriceRule, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
    })

    // Batch-load offering names for the visible rules (single query — avoids N+1)
    const offeringIds = Array.from(
      new Set(items.map((r) => r.productOfferingId).filter((id): id is string => !!id)),
    )
    const offeringNameById = new Map<string, string>()
    if (offeringIds.length > 0) {
      const offerings = await ctx.em.find(
        CpqProductOffering,
        { id: { $in: offeringIds }, ...scope },
      )
      for (const o of offerings) offeringNameById.set(o.id, o.name)
    }

    return NextResponse.json({
      items: items.map((rule) => ({
        ...serializeRule(rule),
        productOfferingName: rule.productOfferingId
          ? offeringNameById.get(rule.productOfferingId) ?? null
          : null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err) {
    console.error('[cpq/price-rules.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqPriceRuleCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const entity = ctx.em.create(CpqPriceRule, {
      ...scope,
      code: body.code,
      name: body.name,
      description: body.description ?? undefined,
      productOfferingId: body.productOfferingId ?? undefined,
      ruleType: body.ruleType,
      value: String(body.value),
      chargeCodeFilter: body.chargeCodeFilter ?? undefined,
      chargeTypeFilter: body.chargeTypeFilter ?? undefined,
      applicabilityCondition: body.applicabilityCondition ?? undefined,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
    })
    await ctx.em.flush()

    return NextResponse.json(serializeRule(entity), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/price-rules.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqPriceRuleUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null }

    const entity = await ctx.em.findOne(CpqPriceRule, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { value: rawValue, ...rest } = updates
    const assignData: Record<string, unknown> = { ...rest }
    if (rawValue !== undefined) assignData.value = String(rawValue)
    ctx.em.assign(entity, assignData)
    await ctx.em.flush()

    return NextResponse.json(serializeRule(entity))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/price-rules.PUT]', err)
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
    const entity = await ctx.em.findOne(CpqPriceRule, { id, ...scope })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    entity.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/price-rules.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
