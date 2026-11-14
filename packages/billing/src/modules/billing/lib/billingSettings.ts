import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingSettings } from '../data/entities'
import { DEFAULT_NUMBER_MASKS, maskFor, type DocumentSeries } from './numbering'

/**
 * Per-organization billing settings (Spec 0, E-D2 / E-D5).
 *
 * Replaces the tenant-wide core `configs` rows billing used to seed. One row
 * per (tenant, organization), created lazily with today's defaults on first
 * read so every caller can rely on it existing. Spec B extends the row with
 * seller / document fields.
 */

export type SettingsScope = { tenantId: string; organizationId: string }

export const BILLING_SETTINGS_DEFAULTS = {
  lowBalanceThresholdDefault: '0',
  nearLimitBufferDefault: '0',
  statementEnabled: true,
  topupTaxRate: '0',
  topupProvider: 'stripe',
  numberMasks: { ...DEFAULT_NUMBER_MASKS } as Record<string, string>,
} as const

export async function getBillingSettings(em: EntityManager, scope: SettingsScope): Promise<BillingSettings> {
  const where = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const existing = await em.findOne(BillingSettings, where as never)
  if (existing) return existing
  // Race-safe create: a concurrent first read may insert the same row; the
  // partial unique index makes ours a no-op and we re-read the winner.
  const now = new Date()
  await em.execute(
    `INSERT INTO billing_settings
       (tenant_id, organization_id, low_balance_threshold_default, near_limit_buffer_default,
        statement_enabled, topup_tax_rate, topup_provider, number_masks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
     ON CONFLICT (tenant_id, organization_id) WHERE deleted_at IS NULL DO NOTHING`,
    [
      scope.tenantId,
      scope.organizationId,
      BILLING_SETTINGS_DEFAULTS.lowBalanceThresholdDefault,
      BILLING_SETTINGS_DEFAULTS.nearLimitBufferDefault,
      BILLING_SETTINGS_DEFAULTS.statementEnabled,
      BILLING_SETTINGS_DEFAULTS.topupTaxRate,
      BILLING_SETTINGS_DEFAULTS.topupProvider,
      JSON.stringify(BILLING_SETTINGS_DEFAULTS.numberMasks),
      now,
      now,
    ],
  )
  const created = await em.findOne(BillingSettings, where as never)
  if (!created) throw new Error('Billing settings could not be initialised')
  return created
}

/** Mask for a series, falling back to the default when unset or invalid. */
export function numberMaskFor(settings: Pick<BillingSettings, 'numberMasks'>, series: DocumentSeries): string {
  return maskFor(settings.numberMasks ?? null, series)
}

function numberOr(value: string | number | null | undefined, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value ?? '')
  return Number.isFinite(n) ? n : fallback
}

/** Plain view of the settings — what the API returns and the UI edits. */
export function serializeBillingSettings(settings: BillingSettings) {
  return {
    id: settings.id,
    lowBalanceThresholdDefault: numberOr(settings.lowBalanceThresholdDefault, 0),
    nearLimitBufferDefault: numberOr(settings.nearLimitBufferDefault, 0),
    statementEnabled: settings.statementEnabled,
    topupTaxRate: numberOr(settings.topupTaxRate, 0),
    topupProvider: settings.topupProvider,
    numberMasks: {
      invoice: numberMaskFor(settings, 'invoice'),
      credit_memo: numberMaskFor(settings, 'credit_memo'),
      receipt: numberMaskFor(settings, 'receipt'),
    },
  }
}
