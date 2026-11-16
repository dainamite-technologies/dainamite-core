import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqCostIndexValue } from '../../data/entities'
import type { TenantScope } from '../types'

/**
 * Index cost resolution (index-costs spec "Index cost resolution and snapshot", App Spec R4). Pure helpers over loaded
 * rows: `costResolution.ts` loads the index values ONCE per recalculation (`loadValuesInForce`), then calls
 * `resolveIndexCost` per `index` cost element. FX (R3) stays in `costResolution.ts`, which owns the rate lookup.
 *
 * Formula: `unit amount = index_factor x value in force + index_offset`, in the index currency, computed on exact
 * decimals (scaled integers, never floating point) and rounded HALF UP to 4 decimals (the precision of every stored
 * cost amount). A `per_unit` element multiplies the rounded unit amount by the charge quantity, like every other source.
 */

export type IndexValueInForce = { indexId: string; effectiveDate: string; revision: number; value: string }

/** The snapshot stored in `cpq_quote_line_costs.index_snapshot` (spec §Data Model). Numbers are trimmed decimal strings. */
export type IndexSnapshot = {
  indexId: string
  currencyCode: string
  effectiveDate: string
  revision: number
  value: string
  factor: string
  offset: string
  asOfDate: string
}

export type IndexCostResult =
  | { ok: true; unitAmount: string; currencyCode: string; snapshot: IndexSnapshot }
  | { ok: false; errorCode: 'INDEX_NO_VALUE' }

const toDate = (value: unknown): string => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10))

/**
 * Value in force per index at `asOfDate` (YYYY-MM-DD): the latest `effective_date` on or before it, then the highest
 * revision. ONE query for all `indexIds` (one per recalculation, never per line). Indices without a value are absent.
 */
export async function loadValuesInForce(em: EntityManager, indexIds: string[], asOfDate: string, scope: TenantScope): Promise<Map<string, IndexValueInForce>> {
  const result = new Map<string, IndexValueInForce>()
  const ids = [...new Set(indexIds)]
  if (ids.length === 0) return result
  const rows = await em.find(CpqCostIndexValue, {
    organizationId: scope.organizationId, tenantId: scope.tenantId, costIndexId: { $in: ids }, effectiveDate: { $lte: asOfDate },
  }, { orderBy: { effectiveDate: 'desc', revision: 'desc' } })
  for (const row of rows) {
    const date = toDate(row.effectiveDate)
    const known = result.get(row.costIndexId)
    // The order is not trusted: pick deterministically (latest date, then highest revision).
    if (!known || date > known.effectiveDate || (date === known.effectiveDate && row.revision > known.revision)) {
      result.set(row.costIndexId, { indexId: row.costIndexId, effectiveDate: date, revision: row.revision, value: row.value })
    }
  }
  return result
}

const SCALE = 6
const ONE = 10n ** BigInt(SCALE)

/** `"82.4"` -> 82400000n (scale 6). Returns null for anything that is not a plain non-negative decimal. */
function toScaled(text: string | number | null | undefined): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(String(text ?? '').trim())
  if (!match) return null
  const fraction = (match[2] ?? '').padEnd(SCALE, '0').slice(0, SCALE)
  return BigInt(match[1]) * ONE + BigInt(fraction)
}

/** Trimmed decimal string of a bigint scaled by 10^scale (`"43.2"`, `"7"`). */
function fromScaled(value: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(scale, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

/** Stable decimal text for snapshots (`"82.400000"` -> `"82.4"`); unparseable input is returned as given. */
export function normalizeDecimal(text: string | number | null | undefined, fallback: string): string {
  if (text === null || text === undefined || text === '') return fallback
  const scaled = toScaled(text)
  return scaled === null ? String(text) : fromScaled(scaled, SCALE)
}

/**
 * `factor x value + offset`, half-up to 4 decimals, as a trimmed decimal string; null when an input is not a valid
 * non-negative decimal (a defensive guard: the DB CHECKs make that unreachable).
 */
export function computeIndexUnitAmount(value: string, factor: string | null | undefined, offset: string | null | undefined): string | null {
  const v = toScaled(value)
  const f = toScaled(factor ?? '1')
  const o = toScaled(offset ?? '0')
  if (v === null || f === null || o === null) return null
  // scale 12 = (f x v) at scale 12 + offset lifted from scale 6; 4 decimals = divide by 10^8 with half-up.
  const exact = f * v + o * ONE
  const step = 10n ** 8n
  return fromScaled((exact + step / 2n) / step, 4)
}

export type ResolveIndexCostInput = {
  element: { costIndexId?: string | null; indexFactor?: string | null; indexOffset?: string | null }
  /** The element's index (its currency); `null` when it no longer exists. */
  index: { id: string; currencyCode: string } | null
  valuesInForce: ReadonlyMap<string, IndexValueInForce>
  asOfDate: string
}

/**
 * Unit amount and snapshot of one `index` cost element at `asOfDate`, in the index currency. No index or no value on or
 * before the date: `INDEX_NO_VALUE` (the caller stores `value_status = none`, the line is not ready).
 */
export function resolveIndexCost({ element, index, valuesInForce, asOfDate }: ResolveIndexCostInput): IndexCostResult {
  const inForce = element.costIndexId ? valuesInForce.get(element.costIndexId) : undefined
  if (!index || !inForce) return { ok: false, errorCode: 'INDEX_NO_VALUE' }
  const unitAmount = computeIndexUnitAmount(inForce.value, element.indexFactor, element.indexOffset)
  if (unitAmount === null) return { ok: false, errorCode: 'INDEX_NO_VALUE' }
  return {
    ok: true, unitAmount, currencyCode: index.currencyCode,
    snapshot: {
      indexId: index.id, currencyCode: index.currencyCode, effectiveDate: inForce.effectiveDate, revision: inForce.revision,
      value: normalizeDecimal(inForce.value, '0'), factor: normalizeDecimal(element.indexFactor, '1'), offset: normalizeDecimal(element.indexOffset, '0'), asOfDate,
    },
  }
}
