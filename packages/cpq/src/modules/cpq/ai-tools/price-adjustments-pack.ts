/**
 * CPQ negotiated-price reads (UX feedback spec D6, §6.5).
 *
 * Read: `cpq.list_price_adjustments`. Price-adjustment **writes** (POST /
 * PATCH / DELETE and `PUT …/price-adjustments/target`) are not tools on
 * purpose: see `manuals/cpq-ai-agent.md` ("not exposed on purpose").
 */
import { z } from 'zod'
import { compactQuery, defineCpqApiTool, pageField, pageSizeField, seg, toPagedOutput, type CpqAiToolDefinition, type CpqPagedApiResponse, type CpqPagedOutput } from './_shared'

export const listPriceAdjustmentsInput = z.object({
  quoteId: z.string().uuid().describe('CPQ quote id or the linked sales quote id (UUID), as returned by cpq.list_quotes.'),
  page: pageField,
  pageSize: pageSizeField,
})
type ListPriceAdjustmentsInput = z.infer<typeof listPriceAdjustmentsInput>

type StoredAdjustment = {
  id: string
  level: 'line' | 'charge'
  quoteLineId: string
  chargeCode?: string | null
  chargeTypeFilter?: 'mrc' | 'nrc' | null
  adjustmentType: string
  value: number
  currencyCode?: string | null
  fromMonth?: number
  toMonth?: number | null
  phaseName?: string | null
  reasonCode: string
  reasonNote?: string | null
  createdByUserId?: string
  createdByName?: string | null
  createdByEmail?: string | null
  createdAt?: string
}
type ListResponse = CpqPagedApiResponse<StoredAdjustment> & { reasons?: Array<{ value: string; label: string }>; enabled?: boolean; pricingRevision?: number }

export type PriceAdjustmentToolItem = {
  id: string
  target: { level: 'line'; quoteLineId: string; chargeTypeFilter: 'mrc' | 'nrc' | null } | { level: 'charge'; quoteLineId: string; chargeCode: string | null }
  fromMonth: number
  /** Inclusive; null = to the end. */
  toMonth: number | null
  phaseName: string | null
  adjustmentType: string
  value: number
  currencyCode: string | null
  reasonCode: string
  reasonLabel: string | null
  reasonNote: string | null
  author: { name: string | null; email: string | null; userId: string | null }
  createdAt: string | null
}

/** Stored row → the tool's flat view: target, months, phase name, reason, author. */
export function toPriceAdjustmentItem(row: StoredAdjustment, reasons: Map<string, string>): PriceAdjustmentToolItem {
  return {
    id: row.id,
    target: row.level === 'charge'
      ? { level: 'charge', quoteLineId: row.quoteLineId, chargeCode: row.chargeCode ?? null }
      : { level: 'line', quoteLineId: row.quoteLineId, chargeTypeFilter: row.chargeTypeFilter ?? null },
    fromMonth: row.fromMonth ?? 1,
    toMonth: row.toMonth ?? null,
    phaseName: row.phaseName ?? null,
    adjustmentType: row.adjustmentType,
    value: row.value,
    currencyCode: row.currencyCode ?? null,
    reasonCode: row.reasonCode,
    reasonLabel: reasons.get(row.reasonCode) ?? null,
    reasonNote: row.reasonNote ?? null,
    author: { name: row.createdByName ?? null, email: row.createdByEmail ?? null, userId: row.createdByUserId ?? null },
    createdAt: row.createdAt ?? null,
  }
}

const listPriceAdjustmentsTool = defineCpqApiTool<ListPriceAdjustmentsInput, ListResponse, CpqPagedOutput<PriceAdjustmentToolItem> & { pricingRevision: number | null }>({
  name: 'cpq.list_price_adjustments',
  displayName: 'List quote price adjustments',
  description:
    'List the negotiated prices (manual price adjustments) on a CPQ quote. Each item has its target (whole line: chargeTypeFilter mrc = recurring, nrc = one-time, null = all charges; or one charge by chargeCode), the months it prices (fromMonth, toMonth; toMonth null = to the end, [1, null] = every month), the phase name sent to billing, the type and value (price_override = set price, discount_percent, discount_absolute), the reason (code, label, note) and the author (name, email). Read-only: price adjustments are changed in the quote\'s Price dialog, not by the assistant. Returns { items, total, page, pageSize, totalPages, pricingRevision }.',
  inputSchema: listPriceAdjustmentsInput,
  requiredFeatures: ['cpq.quotes.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: `/cpq/quotes/${seg(input.quoteId)}/price-adjustments`,
    query: compactQuery({ page: input.page, pageSize: input.pageSize }),
  }),
  mapResponse: (response, input) => {
    const reasons = new Map((response.data?.reasons ?? []).map((reason) => [reason.value, reason.label]))
    const paged = toPagedOutput(response.data, input)
    return { ...paged, items: paged.items.map((row) => toPriceAdjustmentItem(row, reasons)), pricingRevision: response.data?.pricingRevision ?? null }
  },
})

export const priceAdjustmentsAiTools: CpqAiToolDefinition[] = [listPriceAdjustmentsTool]

export default priceAdjustmentsAiTools
