import type { EntityManager } from '@mikro-orm/postgresql'
import { getBillingSettings, type SettingsScope } from './billingSettings'

/**
 * Typed readers for the prepaid billing settings (SPEC-002), stored per
 * organization in `billing_settings` (Spec 0, E-D2 — previously tenant-wide
 * core `configs` rows). Every reader takes the organization scope; the
 * defaults are identical to the old config seed, so behaviour is unchanged.
 */

function asNumberString(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return String(Number(value))
  }
  return fallback
}

/** Low-balance threshold default — numeric string (default '0'). */
export async function getLowBalanceThresholdDefault(em: EntityManager, scope: SettingsScope): Promise<string> {
  return asNumberString((await getBillingSettings(em, scope)).lowBalanceThresholdDefault, '0')
}

/** Near-credit-limit buffer default — numeric string (default '0'). */
export async function getNearLimitBufferDefault(em: EntityManager, scope: SettingsScope): Promise<string> {
  return asNumberString((await getBillingSettings(em, scope)).nearLimitBufferDefault, '0')
}

/** Gateway provider key for top-ups (default 'stripe'). */
export async function getTopupProvider(em: EntityManager, scope: SettingsScope): Promise<string> {
  const value = (await getBillingSettings(em, scope)).topupProvider
  return typeof value === 'string' && value.trim() ? value.trim() : 'stripe'
}

/** Consumption statements master switch (default true). */
export async function getStatementEnabled(em: EntityManager, scope: SettingsScope): Promise<boolean> {
  return (await getBillingSettings(em, scope)).statementEnabled !== false
}

/** VAT percent on top-up receipts (default 0). */
export async function getTopupTaxRate(em: EntityManager, scope: SettingsScope): Promise<number> {
  const n = Number((await getBillingSettings(em, scope)).topupTaxRate)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
