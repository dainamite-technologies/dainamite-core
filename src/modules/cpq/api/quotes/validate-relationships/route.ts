import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../context'
import { cpqValidateRelationshipsSchema } from '../../../data/validators'
import { DefaultCpqValidationService } from '../../../services/cpqValidationService'
import {
  CpqProductOffering,
  CpqProductSpecification,
  CpqProductRelationship,
} from '../../../data/entities'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqValidateRelationshipsSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const dbScope = { ...scope, deletedAt: null }

    // Resolve offerings -> specs
    const offerings = await ctx.em.find(CpqProductOffering, {
      id: { $in: body.offeringIds },
      ...dbScope,
    })

    const specIds = [...new Set(offerings.map((o) => o.specId))]

    // Build mock lines for relationship validation
    const lines = offerings.map((o, i) => ({
      lineId: `mock-${i}`,
      specId: o.specId,
      parentLineId: null as string | null,
    }))

    // Apply parent-child pairs
    if (body.parentChildPairs) {
      for (const pair of body.parentChildPairs) {
        const parentOffering = offerings.find((o) => o.id === pair.parentOfferingId)
        const childLine = lines.find((l) => {
          const off = offerings.find((o) => o.specId === l.specId && o.id === pair.childOfferingId)
          return !!off
        })
        const parentLine = lines.find((l) => {
          const off = offerings.find((o) => o.specId === l.specId && o.id === pair.parentOfferingId)
          return !!off
        })
        if (childLine && parentLine) {
          childLine.parentLineId = parentLine.lineId
        }
      }
    }

    const validationService = ctx.container.resolve('cpqValidationService') as DefaultCpqValidationService
    const errors = await validationService.validateRelationships({ lines, scope })

    // Load allowed child specs
    const parentChildRels = await ctx.em.find(CpqProductRelationship, {
      sourceSpecId: { $in: specIds },
      relationshipType: 'parent_child',
      isActive: true,
      ...dbScope,
    })

    const childSpecIds = [...new Set(parentChildRels.map((r) => r.targetSpecId))]
    const childSpecs = childSpecIds.length > 0
      ? await ctx.em.find(CpqProductSpecification, { id: { $in: childSpecIds }, ...dbScope })
      : []

    const allowedChildSpecs = parentChildRels.map((rel) => {
      const spec = childSpecs.find((s) => s.id === rel.targetSpecId)
      const currentCount = lines.filter((l) => l.specId === rel.targetSpecId).length
      return {
        specId: rel.targetSpecId,
        code: spec?.code ?? '',
        name: spec?.name ?? '',
        productId: spec?.productId ?? '',
        cardinalityMin: rel.cardinalityMin,
        cardinalityMax: rel.cardinalityMax ?? null,
        currentCount,
      }
    })

    return NextResponse.json({
      valid: errors.length === 0,
      errors,
      allowedChildSpecs,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/quotes/validate-relationships.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
