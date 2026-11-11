import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqPriceAdjustmentPatchSchema } from '../../../../../data/price-adjustments'
import { adjustmentCommandRoute } from '../../../../_helpers/adjustmentCommandRoute'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.quotes.adjust_price'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.quotes.adjust_price'] },
}
const pathParams = z.object({ quoteId: z.string().uuid(), adjustmentId: z.string().uuid() })
const deletionSchema = z.object({ expectedRevision: z.coerce.number().int().min(0).optional() }).strict()
type Params = { params: Promise<{ quoteId: string; adjustmentId: string }> }
export async function PATCH(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, adjustmentId } = pathParams.parse(await params)
    const body = cpqPriceAdjustmentPatchSchema.parse(await req.json())
    return await adjustmentCommandRoute(req, ctx, quoteId, body, cpqPriceAdjustmentPatchSchema, 'update', adjustmentId)
  } catch (error) { return handleArcError(error, 'cpq/price-adjustments.PATCH') }
}
export async function DELETE(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, adjustmentId } = pathParams.parse(await params)
    const body = deletionSchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    return await adjustmentCommandRoute(req, ctx, quoteId, body, deletionSchema, 'delete', adjustmentId)
  } catch (error) { return handleArcError(error, 'cpq/price-adjustments.DELETE') }
}
const errors = [cpqErrorDoc(400, 'Invalid input'), cpqErrorDoc(403, 'Missing permission or disabled feature'), cpqErrorDoc(404, 'Quote or adjustment not found'), cpqErrorDoc(409, 'Adjustment locked, stale revision or changed undo target'), cpqErrorDoc(422, 'Invalid adjustment or guard rejection')]
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams, methods: {
  PATCH: { summary: 'Update a negotiated quote price adjustment', requestBody: { schema: cpqPriceAdjustmentPatchSchema }, responses: [{ status: 200, description: 'Adjustment and updated quote' }], errors },
  DELETE: { summary: 'Remove a negotiated quote price adjustment', query: deletionSchema, responses: [{ status: 200, description: 'Updated quote' }], errors },
} }
