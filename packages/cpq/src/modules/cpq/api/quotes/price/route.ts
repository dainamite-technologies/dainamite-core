import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'
import { resolveCpqRouteContext } from '../../context'
import { cpqPricePreviewSchema } from '../../../data/validators'
import type { DefaultCpqPricingService } from '../../../services/cpqPricingService'
import type { ResolvedCharge } from '../../../services/types'
import { getBaseCurrencyCode } from '../../../services/types'
import type { CpqCostService } from '../../../services/costs/costService'
import { presentCostPlusCharge, type PublicCharge, resolveCalculatePriceCostContexts } from '../../../services/costs/calculatePriceCosts'
import { withChargeWaterfall, withoutChargeWaterfall } from '../../../services/priceAdjustments/chargeWaterfall'

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

    const items = [...(body.primaryItem ? [body.primaryItem] : []), ...body.childItems]
    const costService = ctx.container.resolve('cpqCostService') as CpqCostService
    const contexts = await resolveCalculatePriceCostContexts({
      em: ctx.em, isEnabled: (tenantId) => costService.enabled(tenantId), currencyCode, scope,
      items: items.map((item) => ({ offeringId: item.offeringId, productId: item.productId, configuration: item.configuration })),
    })
    const resolveItem = async (item: (typeof items)[number], index: number) => {
      const costPlus = contexts[index]
      const charges = await pricingService.resolveProductCharges({
        offeringId: item.offeringId ?? undefined,
        productId: item.productId ?? undefined,
        configuration: item.configuration,
        currencyCode,
        ...scope,
        costPlus,
      })
      return charges.map((charge) => presentCostPlusCharge(charge, costPlus))
    }

    let primaryCharges: ResolvedCharge[] = []
    let offset = 0
    if (body.primaryItem) {
      primaryCharges = await resolveItem(body.primaryItem, 0)
      offset = 1
    }

    const childItems: Array<{ offeringId: string | null; productId: string | null; charges: ResolvedCharge[] }> = []
    for (const [index, child] of body.childItems.entries()) {
      childItems.push({
        offeringId: child.offeringId ?? null,
        productId: child.productId ?? null,
        charges: await resolveItem(child, index + offset),
      })
    }

    const allCharges = [...primaryCharges, ...childItems.flatMap((c) => c.charges)]

    const nrcTotal = allCharges
      .filter((c) => c.chargeType === 'nrc' && c.totalPrice != null)
      .reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    const mrcTotal = allCharges
      .filter((c) => c.chargeType === 'mrc' && c.totalPrice != null)
      .reduce((s, c) => s + (c.totalPrice ?? 0), 0)
    // Price-on-request charges are never part of the totals.
    const usageCharges = allCharges
      .filter((c) => c.chargeType === 'usage' && !(c as PublicCharge).priceOnRequest)
      .map((c) => ({
        chargeCode: c.chargeCode,
        chargeName: c.chargeName,
        unitPrice: c.unitPrice,
        note: c.note ?? 'Usage-based charge — billed on actual consumption.',
      }))

    const presentCharge = body.includeWaterfall ? withChargeWaterfall : withoutChargeWaterfall
    return NextResponse.json({
      primaryCharges: primaryCharges.map(presentCharge),
      childItems: childItems.map((item) => ({ ...item, charges: item.charges.map(presentCharge) })),
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


const chargeDoc = z.object({
  chargeCode: z.string(), chargeName: z.string(), chargeType: z.enum(['nrc', 'mrc', 'usage']),
  pricingMethod: z.enum(['flat', 'per_unit', 'volume', 'tiered', 'cost_plus']), currencyCode: z.string(),
  unitPrice: z.number().nullable(), quantity: z.number().nullable(), totalPrice: z.number().nullable(),
  indicative: z.boolean().optional().describe('Cost-plus charge priced from at least one on-request estimate.'),
  priceOnRequest: z.boolean().optional().describe('Cost-plus charge that cannot be priced (pending cost, no price basis, or cost-plus disabled): unitPrice and totalPrice are null and it is excluded from totals.'),
  listUnitPrice: z.number().nullable().optional(), listTotalPrice: z.number().nullable().optional(),
  standardUnitPrice: z.number().optional(), standardTotalPrice: z.number().nullable().optional(),
  adjustments: z.array(z.object({ origin: z.literal('rule'), ruleCode: z.string(), ruleName: z.string(),
    ruleType: z.string(), value: z.number(), unitPriceBefore: z.number(), unitPriceAfter: z.number(), delta: z.number() }).passthrough()).nullish(),
}).passthrough()
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Pricing', methods: { POST: {
  summary: 'Calculate catalog prices and price rules without saving',
  description: 'Cost-plus charges are priced from catalog costs resolved in memory (additive fields indicative / priceOnRequest); costs, suppliers and markup are never returned. Manual quote adjustments are never applied. Set includeWaterfall=true to return list and standard prices; these fields are omitted by default.',
  requestBody: { schema: cpqPricePreviewSchema },
  responses: [{ status: 200, description: 'Resolved rule prices and optional waterfall', schema: z.object({
    primaryCharges: z.array(chargeDoc),
    childItems: z.array(z.object({ offeringId: z.string().nullable(), productId: z.string().nullable(), charges: z.array(chargeDoc) })),
    totals: z.object({ nrcTotal: z.number(), mrcTotal: z.number(), usageCharges: z.array(z.unknown()) }), currencyCode: z.string(),
  }) }],
  errors: [cpqErrorDoc(400, 'Invalid pricing request'), cpqErrorDoc(500, 'Price calculation failed')],
} } }
