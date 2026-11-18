import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../context'
import { COST_INDEX_IMPORT_MAX_ROWS, COST_INDEX_WRITE_FEATURES, cpqCostIndexImportRowSchema, cpqCostIndexImportSchema } from '../../../data/cost-indices'
import type { IndexValueWriteResult } from '../../../commands/cost-indices'
import { costIndexCommandRoute, enabledIndexService, indexScope, indexToggleOff } from '../../_helpers/costIndexRoute'
import { handleArcError } from '../../_helpers/handleArcError'
import { CPQ_COST_INDEX_VALUE_RESOURCE_KIND } from '../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'

export const metadata = { POST: { requireAuth: true, requireFeatures: [...COST_INDEX_WRITE_FEATURES] } }

/**
 * Bulk import of index values, all-or-nothing. A dry run validates and reports without writing, so it is not a
 * command (no action-log entry) and runs no mutation guard; a real import is one `cpq.cost_index_value.append` command.
 */
export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = cpqCostIndexImportSchema.parse(await req.json())
    if (body.dryRun) {
      const service = await enabledIndexService(ctx)
      if (!service) return indexToggleOff()
      return NextResponse.json(await service.importValues(body.items, indexScope(ctx), { dryRun: true }))
    }
    const importSchema = cpqCostIndexImportSchema.omit({ dryRun: true })
    return await costIndexCommandRoute<z.infer<typeof importSchema>, IndexValueWriteResult>(req, ctx, {
      commandId: 'cpq.cost_index_value.append', resourceKind: CPQ_COST_INDEX_VALUE_RESOURCE_KIND, operation: 'create',
      body: { items: body.items }, schema: importSchema, buildInput: (effective) => ({ import: effective }),
      respond: ({ batchId, results }) => ({ batchId, dryRun: false, results }), status: 200,
    })
  } catch (error) { return handleArcError(error, 'cpq/cost-indices/import.POST') }
}

const rowResult = z.object({ row: z.number().describe('1-based position in the request'), indexCode: z.string(), effectiveDate: z.string(), status: z.enum(['created', 'unchanged']), revision: z.number() })
const toggleOff = cpqErrorDoc(404, 'Not found — also returned while the tenant toggle cpq.cost_plus is off')
export const openApi: OpenApiRouteDoc = { tag: 'CPQ cost indices', methods: {
  POST: { summary: `Import up to ${COST_INDEX_IMPORT_MAX_ROWS} index values addressed by index code, all-or-nothing; rows equal to the current highest revision of their date are reported unchanged; dryRun validates without writing`,
    requestBody: { schema: z.object({ items: z.array(cpqCostIndexImportRowSchema).min(1).max(COST_INDEX_IMPORT_MAX_ROWS), dryRun: z.boolean().optional() }) },
    responses: [{ status: 200, description: 'Per-row outcome; batchId is null on a dry run', schema: z.object({ batchId: z.string().uuid().nullable(), dryRun: z.boolean(), results: z.array(rowResult) }) }],
    errors: [cpqErrorDoc(400, 'Validation error (envelope: 1..1000 rows)'), cpqErrorDoc(403, 'Missing cpq.pricing.manage or cpq.costs.view'), toggleOff,
      cpqErrorDoc(409, 'CONCURRENT_INDEX_WRITE: retry the whole import'),
      cpqErrorDoc(422, 'IMPORT_VALIDATION_FAILED with errors [{row, code: UNKNOWN_INDEX | INDEX_INACTIVE | INVALID_VALUE | DUPLICATE_ROW, indexCode?}] (nothing written) or a mutation-guard rejection')] },
} }
