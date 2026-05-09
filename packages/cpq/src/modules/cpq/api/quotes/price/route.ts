import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../context'
import { cpqPricePreviewSchema } from '../../../data/validators'
import type { DefaultCpqPricingService } from '../../../services/cpqPricingService'
import type { ResolvedCharge } from '../../../services/types'
import { getBaseCurrencyCode } from '../../../services/types'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.view'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqPricePreviewSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const currencyCode = body.currencyCode ?? await getBaseCurrencyCode(ctx.em, scope)

    const pricingService = ctx.container.resolve('cpqPricingService') as DefaultCpqPricingService

    let primaryCharges: ResolvedCharge[] = []
    if (body.primaryItem) {
      primaryCharges = await pricingService.resolveProductCharges({
        offeringId: body.primaryItem.offeringId ?? undefined,
        productId: body.primaryItem.productId ?? undefined,
        configuration: body.primaryItem.configuration,
        currencyCode,
        ...scope,
      })
    }

    const childItems: Array<{ offeringId: string | null; productId: string | null; charges: ResolvedCharge[] }> = []
    for (const child of body.childItems) {
      const charges = await pricingService.resolveProductCharges({
        offeringId: child.offeringId ?? undefined,
        productId: child.productId ?? undefined,
        configuration: child.configuration,
        currencyCode,
        ...scope,
      })
      childItems.push({
        offeringId: child.offeringId ?? null,
        productId: child.productId ?? null,
        charges,
      })
    }

    const allCharges = [...primaryCharges, ...childItems.flatMap((c) => c.charges)]

    const nrcTotal = allCharges
      .filter((c) => c.chargeType === 'nrc' && c.totalPrice != null)
      .reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    const mrcTotal = allCharges
      .filter((c) => c.chargeType === 'mrc' && c.totalPrice != null)
      .reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    const usageCharges = allCharges
      .filter((c) => c.chargeType === 'usage')
      .map((c) => ({
        chargeCode: c.chargeCode,
        chargeName: c.chargeName,
        unitPrice: c.unitPrice,
        note: c.note ?? 'Usage-based charge — billed on actual consumption.',
      }))

    return NextResponse.json({
      primaryCharges,
      childItems,
      totals: { nrcTotal, mrcTotal, usageCharges },
      currencyCode,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/quotes/price.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
