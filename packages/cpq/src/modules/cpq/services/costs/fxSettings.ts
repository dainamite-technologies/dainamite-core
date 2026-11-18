import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { FX_MAX_DAYS_BACK_DEFAULT, FX_MAX_DAYS_BACK_LIMIT, FX_MAX_DAYS_BACK_TOGGLE, FX_SOURCE_PRIORITY_TOGGLE } from '../../data/costs'

/** Tenant FX settings (FX Q1 / Q2). */
export type FxSettings = {
  /** Look-back days of the rate lookup, an integer in 0-30. */
  maxDaysBack: number
  /** Ordered `ExchangeRate.source` names; empty means "no preference". */
  sourcePriority: string[]
}

export type FxSettingsToggles = Pick<FeatureTogglesService, 'getNumberConfig' | 'getJsonConfig'>

export const DEFAULT_FX_SETTINGS: FxSettings = { maxDaysBack: FX_MAX_DAYS_BACK_DEFAULT, sourcePriority: [] }

/** A missing / mismatched / non-finite value falls back to the default; a number is floored and clamped to 0-30. */
export function clampMaxDaysBack(value: unknown): number {
  const number = typeof value === 'number' ? value : NaN
  if (!Number.isFinite(number)) return FX_MAX_DAYS_BACK_DEFAULT
  return Math.min(FX_MAX_DAYS_BACK_LIMIT, Math.max(0, Math.floor(number)))
}

/** Keeps trimmed non-empty strings in order, dropping duplicates; anything that is not an array is `[]`. */
export function normalizeSourcePriority(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sources: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const source = entry.trim()
    if (source && !seen.has(source)) { seen.add(source); sources.push(source) }
  }
  return sources
}

/** Reads both toggles; a throwing toggle service degrades to the defaults (rate lookup is reference data, Q8). */
export async function readFxSettings(featureTogglesService: FxSettingsToggles | null | undefined, tenantId: string): Promise<FxSettings> {
  if (!featureTogglesService) return { ...DEFAULT_FX_SETTINGS }
  const [days, priority] = await Promise.all([
    featureTogglesService.getNumberConfig(FX_MAX_DAYS_BACK_TOGGLE, tenantId).catch(() => null),
    featureTogglesService.getJsonConfig<unknown>(FX_SOURCE_PRIORITY_TOGGLE, tenantId).catch(() => null),
  ])
  return {
    maxDaysBack: days && days.ok ? clampMaxDaysBack(days.value) : FX_MAX_DAYS_BACK_DEFAULT,
    sourcePriority: priority && priority.ok ? normalizeSourcePriority(priority.value) : [],
  }
}
