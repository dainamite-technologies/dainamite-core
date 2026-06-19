import type { EntityManager } from '@mikro-orm/postgresql'
import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'

/**
 * Typed readers for the prepaid billing module configs (SPEC-002), seeded by
 * `setup.ts → seedBillingConfigs`. Stored as raw JSON scalars in
 * `ModuleConfig.valueJson`. Each reader falls back to the same default the
 * seed uses, so a missing row (older tenant) behaves identically.
 */

async function readConfig(em: EntityManager, name: string): Promise<unknown> {
  const row = await em.findOne(ModuleConfig, { moduleId: 'billing', name })
  if (!row) return undefined
  return row.valueJson as unknown
}

function asNumberString(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return value.trim()
  }
  return fallback
}

/** `prepaid.low_balance_threshold_default` — numeric string (default '0'). */
export async function getLowBalanceThresholdDefault(em: EntityManager): Promise<string> {
  return asNumberString(await readConfig(em, 'prepaid.low_balance_threshold_default'), '0')
}

/** `credit.near_limit_buffer_default` — numeric string (default '0'). */
export async function getNearLimitBufferDefault(em: EntityManager): Promise<string> {
  return asNumberString(await readConfig(em, 'credit.near_limit_buffer_default'), '0')
}

/** `prepaid.topup_provider` — gateway provider key (default 'stripe'). */
export async function getTopupProvider(em: EntityManager): Promise<string> {
  const value = await readConfig(em, 'prepaid.topup_provider')
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'stripe'
}

/** `prepaid.statement_enabled` — master switch (default true). */
export async function getStatementEnabled(em: EntityManager): Promise<boolean> {
  const value = await readConfig(em, 'prepaid.statement_enabled')
  if (value === undefined || value === null) return true
  if (typeof value === 'boolean') return value
  // A stored string "false" must read as false (Boolean("false") === true).
  if (typeof value === 'string') return value.trim().toLowerCase() !== 'false'
  return Boolean(value)
}

/** `prepaid.topup_tax_rate` — VAT percent on top-up receipts (default 0). */
export async function getTopupTaxRate(em: EntityManager): Promise<number> {
  const value = await readConfig(em, 'prepaid.topup_tax_rate')
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  return 0
}
