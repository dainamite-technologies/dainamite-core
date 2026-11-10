import type { CpqQuoteConfiguration, CpqQuoteLineConfiguration } from '../../data/entities'
import { adjustmentErrorSchema } from '../../data/price-adjustments'

type Failure = { lineId: string | null; code: string }
function recordedError(value: unknown, fallback: string | null): Failure | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const parsed = adjustmentErrorSchema.shape.code.safeParse(record.code ?? record.message)
  return parsed.success ? { lineId: typeof record.lineId === 'string' ? record.lineId : fallback, code: parsed.data } : null
}

/** Conversion validates the reviewed stored snapshot, without calling the price engine. */
export function storedAdjustmentFailure(quote: CpqQuoteConfiguration, lines: CpqQuoteLineConfiguration[]): Failure | null {
  for (const line of lines) {
    for (const charge of line.charges ?? []) {
      if (Array.isArray(charge.adjustmentErrors) && charge.adjustmentErrors.length) {
        return recordedError(charge.adjustmentErrors[0], line.quoteLineId) ?? { lineId: line.quoteLineId, code: 'ADJUSTMENT_INVALID' }
      }
    }
    for (const error of line.validationErrors ?? []) {
      const failure = recordedError(error, line.quoteLineId)
      if (failure) return failure
    }
  }
  const errors = quote.validationResult?.errors
  if (Array.isArray(errors)) for (const error of errors) {
    const failure = recordedError(error, null)
    if (failure) return failure
  }
  return null
}
