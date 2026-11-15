import type { TenantScope } from '../types'
import { readFxSettings, type FxSettings, type FxSettingsToggles } from './fxSettings'

/**
 * Structural subset of the `currencies` module's `ExchangeRateService` (`getRate`, node_modules/@open-mercato/core/
 * src/modules/currencies/services/exchangeRateService.ts). CPQ ships standalone, so it never imports `currencies`:
 * the service is resolved by its DI name and typed through this interface (FX spec §Architecture, Q7).
 * `rate` is `toCurrency` units per 1 `fromCurrency` unit; `rates` holds the rows of ALL providers for the first date found.
 */
export interface FxExchangeRateService {
  getRate(params: {
    fromCurrencyCode: string
    toCurrencyCode: string
    date: Date
    scope: { tenantId: string; organizationId: string }
    options?: { maxDaysBack?: number; autoFetch?: boolean }
  }): Promise<{ rates: Array<{ rate: string; source: string }>; actualDate: Date | null }>
}

export type FxDerivation = 'direct' | 'inverse'

export type FxResolveInput = {
  /** Cost currency. */
  from: string
  /** Quote currency. */
  to: string
  /** Rate date; defaults to the current UTC date (Q4). Normalized to UTC midnight. */
  date?: Date
  scope: TenantScope
}

export type FxResolveResult =
  | {
      ok: true
      /** `to` units per 1 `from` unit, 8 decimal places. */
      rate: string
      /** The date the rate applies to (`YYYY-MM-DD`, UTC); may be earlier than the requested date (look-back). */
      rateDate: string
      /** `ExchangeRate.source` as stored. */
      source: string
      derivation: FxDerivation
    }
  | {
      ok: false
      code: 'CURRENCY_NO_RATE'
      /**
       * `unavailable`: no `currencies` service. `not_found`: no usable rate in either direction. `error`: the service threw.
       * `same_currency`: nothing to convert; callers must not call `resolve` for it (the rate is 1, no FX columns are set).
       */
      reason: 'unavailable' | 'not_found' | 'error' | 'same_currency'
    }

export type FxRateResolverDeps = {
  /** `exchangeRateService` when the `currencies` module is registered, else absent. */
  exchangeRateService?: FxExchangeRateService | null
  featureTogglesService?: FxSettingsToggles | null
  /** Test seam for the UTC-today default. */
  now?: () => Date
}

const RATE_DECIMALS = 8
const DAY = (date: Date) => date.toISOString().slice(0, 10)
const utcMidnight = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
const NOT_FOUND = { ok: false, code: 'CURRENCY_NO_RATE', reason: 'not_found' } as const

type Candidate = { rate: number; source: string; raw: string }

/** Positive finite rows only: a zero / negative / unparsable stored rate is never usable (and never inverted). */
function candidatesOf(rates: Array<{ rate: string; source: string }>): Candidate[] {
  const out: Candidate[] = []
  for (const row of rates) {
    const rate = Number(row.rate)
    if (Number.isFinite(rate) && rate > 0 && typeof row.source === 'string') out.push({ rate, source: row.source, raw: String(row.rate) })
  }
  return out
}

/** Q2: first listed source that has a rate; otherwise the only row; otherwise `source` ascending. */
export function pickBySourceRule(candidates: Candidate[], priority: string[]): Candidate | null {
  if (candidates.length === 0) return null
  for (const source of priority) {
    const hit = candidates.find((candidate) => candidate.source === source)
    if (hit) return hit
  }
  return [...candidates].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))[0]
}

/** Pads / rounds a stored decimal string to 8 dp (the column is numeric(18,8), so this is a no-op for real rows). */
const formatRate = (value: number, raw?: string): string =>
  raw !== undefined && /^\d+(\.\d+)?$/.test(raw) && (raw.split('.')[1] ?? '').length <= RATE_DECIMALS
    ? `${raw.split('.')[0]}.${(raw.split('.')[1] ?? '').padEnd(RATE_DECIMALS, '0')}`
    : value.toFixed(RATE_DECIMALS)

/**
 * Resolves a dated FX rate for a cost currency into the quote currency (FX spec Q1-Q4, Q7, Q8).
 *
 * - Direct pair (`from` -> `to`) first, from any source; the inverse pair (`to` -> `from`, `1 / rate` rounded to 8 dp,
 *   derivation `inverse`) only when NO source has a direct rate. No triangulation.
 * - Reads through `exchangeRateService.getRate({ ..., options: { autoFetch: false, maxDaysBack } })`: reference data, no
 *   network I/O. `maxDaysBack` and the source priority come from the tenant's toggles (`readFxSettings`).
 * - Never throws: a throwing service is `CURRENCY_NO_RATE` / `error`. Never converts 1:1.
 * - Memoized per `(tenant, organization, from, to, day)` for the lifetime of the instance (DI-scoped: one request / write).
 */
export class CpqFxRateResolver {
  private readonly memo = new Map<string, Promise<FxResolveResult>>()
  private readonly settingsMemo = new Map<string, Promise<FxSettings>>()

  constructor(private readonly deps: FxRateResolverDeps = {}) {}

  /** `false` when the `currencies` module is not installed: every foreign cost stays `CURRENCY_NO_RATE` (PR #87 behaviour). */
  available(): boolean {
    return Boolean(this.deps.exchangeRateService)
  }

  resolve(input: FxResolveInput): Promise<FxResolveResult> {
    const from = input.from.trim().toUpperCase()
    const to = input.to.trim().toUpperCase()
    if (from === to) return Promise.resolve({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'same_currency' })
    if (!this.deps.exchangeRateService) return Promise.resolve({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'unavailable' })
    const date = utcMidnight(input.date ?? (this.deps.now ?? (() => new Date()))())
    const key = `${input.scope.tenantId}|${input.scope.organizationId}|${from}>${to}|${DAY(date)}`
    let pending = this.memo.get(key)
    if (!pending) {
      pending = this.lookup(this.deps.exchangeRateService, from, to, date, input.scope)
      this.memo.set(key, pending)
    }
    return pending
  }

  private settings(tenantId: string): Promise<FxSettings> {
    let pending = this.settingsMemo.get(tenantId)
    if (!pending) {
      pending = readFxSettings(this.deps.featureTogglesService, tenantId)
      this.settingsMemo.set(tenantId, pending)
    }
    return pending
  }

  private async lookup(service: FxExchangeRateService, from: string, to: string, date: Date, scope: TenantScope): Promise<FxResolveResult> {
    try {
      const settings = await this.settings(scope.tenantId)
      const read = (fromCurrencyCode: string, toCurrencyCode: string) => service.getRate({
        fromCurrencyCode, toCurrencyCode, date, scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
        options: { autoFetch: false, maxDaysBack: settings.maxDaysBack },
      })

      const direct = await read(from, to)
      const directPick = pickBySourceRule(candidatesOf(direct.rates ?? []), settings.sourcePriority)
      if (directPick && direct.actualDate) {
        return { ok: true, rate: formatRate(directPick.rate, directPick.raw), rateDate: DAY(direct.actualDate), source: directPick.source, derivation: 'direct' }
      }

      const inverse = await read(to, from)
      const inversePick = pickBySourceRule(candidatesOf(inverse.rates ?? []), settings.sourcePriority)
      const inverted = inversePick ? (1 / inversePick.rate).toFixed(RATE_DECIMALS) : null
      // A rate that rounds to zero at 8 dp is not a usable rate.
      if (inversePick && inverse.actualDate && inverted !== null && Number(inverted) > 0) {
        return { ok: true, rate: inverted, rateDate: DAY(inverse.actualDate), source: inversePick.source, derivation: 'inverse' }
      }
      return NOT_FOUND
    } catch (error) {
      // Rate lookup is reference data: the write never fails because of FX (Q8). Logged without amounts.
      console.warn(`[cpq.fx] exchange rate lookup ${from}>${to} failed: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, code: 'CURRENCY_NO_RATE', reason: 'error' }
    }
  }
}
