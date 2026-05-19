import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  Dictionary,
  DictionaryEntry,
} from '@open-mercato/core/modules/dictionaries/data/entities'
import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'

/**
 * Billing module setup — per-tenant defaults at module installation.
 *
 * Idempotency contract:
 *   - All seed helpers below check for an existing row before inserting.
 *   - Safe to re-run on every `mercato init` and on `auth sync-role-acls`.
 *
 * What this file seeds:
 *   - `billing.uom` dictionary with 16 global codes (operators can add more).
 *   - `sales.invoice_status` dictionary with `draft` / `posted` / `paid` /
 *     `void` so the core/sales Invoice entity's dictionary-driven status
 *     workflow has values to point at. (Core/sales does NOT seed these —
 *     billing owns them per Phase 0 validation.)
 *   - `billing.cron_schedule` + `billing.cron_enabled` module configs.
 *   - `billing.invoice_number.format` + `.reset_cycle` configs (per-tenant
 *     defaults; the actual atomic numbering uses core/sales'
 *     `SalesDocumentSequence` which is created by core/sales' own
 *     `onTenantCreated`).
 *
 * Default role-feature grants:
 *   - `admin` gets every `billing.*` feature.
 *   - `billing_admin` is the day-to-day finance operator.
 *   - `billing_finance_user` is read + dry-run (no posting / no real trigger).
 *   - `billing_usage_writer` is the narrow scope for external system API keys.
 */

const BILLING_UOM_DICTIONARY_KEY = 'billing.uom'
const SALES_INVOICE_STATUS_DICTIONARY_KEY = 'sales.invoice_status'

const BILLING_UOM_CODES = [
  // time
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  // volume
  { value: 'gb', label: 'Gigabyte' },
  { value: 'tb', label: 'Terabyte' },
  { value: 'mb', label: 'Megabyte' },
  // requests / tokens
  { value: 'request', label: 'Request' },
  { value: 'api_request', label: 'API Request' },
  { value: 'token', label: 'Token' },
  { value: 'input_token', label: 'Input Token' },
  { value: 'output_token', label: 'Output Token' },
  // seats / devices
  { value: 'seat', label: 'Seat' },
  { value: 'user', label: 'User' },
  { value: 'device', label: 'Device' },
  { value: 'active_user', label: 'Active User' },
] as const

const INVOICE_STATUS_ENTRIES = [
  // `posted` is the canonical "issued" state and is also the default a
  // freshly created invoice transitions to — but billing creates drafts,
  // so `draft` is the default DictionaryEntry for new rows.
  { value: 'draft', label: 'Draft', isDefault: true, color: '#9ca3af' },
  { value: 'posted', label: 'Posted', isDefault: false, color: '#2563eb' },
  { value: 'paid', label: 'Paid', isDefault: false, color: '#16a34a' },
  { value: 'void', label: 'Void', isDefault: false, color: '#dc2626' },
] as const

type SeedScope = { tenantId: string; organizationId: string }

async function ensureDictionary(
  em: EntityManager,
  scope: SeedScope,
  params: { key: string; name: string; description: string },
): Promise<Dictionary> {
  const existing = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: params.key,
    deletedAt: null,
  })
  if (existing) return existing
  const dictionary = em.create(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: params.key,
    name: params.name,
    description: params.description,
    isSystem: true,
    isActive: true,
    managerVisibility: 'hidden',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(dictionary)
  await em.flush()
  return dictionary
}

async function ensureDictionaryEntries(
  em: EntityManager,
  scope: SeedScope,
  dictionary: Dictionary,
  entries: ReadonlyArray<{
    value: string
    label: string
    isDefault?: boolean
    color?: string
  }>,
): Promise<void> {
  const existing = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const existingValues = new Set(existing.map((e) => e.value))
  let position = existing.length
  for (const entry of entries) {
    if (existingValues.has(entry.value)) continue
    em.persist(
      em.create(DictionaryEntry, {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        value: entry.value,
        normalizedValue: entry.value.trim().toLowerCase(),
        label: entry.label,
        color: entry.color ?? null,
        position,
        isDefault: entry.isDefault ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    position += 1
  }
  await em.flush()
}

async function seedBillingUomDictionary(em: EntityManager, scope: SeedScope): Promise<void> {
  const dict = await ensureDictionary(em, scope, {
    key: BILLING_UOM_DICTIONARY_KEY,
    name: 'Billing units of measure',
    description: 'Units billing accepts on usage records (exact match — no conversion).',
  })
  await ensureDictionaryEntries(em, scope, dict, BILLING_UOM_CODES)
}

async function seedInvoiceStatusDictionary(em: EntityManager, scope: SeedScope): Promise<void> {
  const dict = await ensureDictionary(em, scope, {
    key: SALES_INVOICE_STATUS_DICTIONARY_KEY,
    name: 'Sales invoice statuses',
    description: 'draft → posted → paid (or void). Drives the billing draft/post lifecycle.',
  })
  await ensureDictionaryEntries(em, scope, dict, INVOICE_STATUS_ENTRIES)
}

async function ensureModuleConfig(
  em: EntityManager,
  params: { moduleId: string; name: string; value: unknown },
): Promise<void> {
  const existing = await em.findOne(ModuleConfig, {
    moduleId: params.moduleId,
    name: params.name,
  })
  if (existing) return
  em.persist(
    em.create(ModuleConfig, {
      moduleId: params.moduleId,
      name: params.name,
      valueJson: params.value as Record<string, unknown> | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  )
  await em.flush()
}

async function seedBillingConfigs(em: EntityManager): Promise<void> {
  await ensureModuleConfig(em, {
    moduleId: 'billing',
    name: 'cron_schedule',
    value: '0 2 * * *',
  })
  await ensureModuleConfig(em, {
    moduleId: 'billing',
    name: 'cron_enabled',
    value: true,
  })
  await ensureModuleConfig(em, {
    moduleId: 'billing',
    name: 'invoice_number.format',
    value: 'INV-{YYYY}-{0000001}',
  })
  await ensureModuleConfig(em, {
    moduleId: 'billing',
    name: 'invoice_number.reset_cycle',
    value: 'yearly',
  })
}

const ALL_BILLING_FEATURES = [
  'billing.account.manage',
  'billing.account.view',
  'billing.item.manage',
  'billing.item.view',
  'billing.usage.ingest',
  'billing.usage.view',
  'billing.run.trigger',
  'billing.run.dry_run',
  'billing.run.view',
  'billing.invoice.post',
  'billing.invoice.edit_draft',
  'billing.invoice.view',
] as const

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    // Org admins get every billing feature — `billing.*` wildcard is matched
    // by the shared feature matcher (`hasFeature` is wildcard-aware).
    admin: ['billing.*'],

    // Day-to-day finance operator persona.
    billing_admin: [...ALL_BILLING_FEATURES],

    // Read-only + dry-run preview — auditor / finance-watcher persona.
    billing_finance_user: [
      'billing.account.view',
      'billing.item.view',
      'billing.usage.view',
      'billing.run.view',
      'billing.run.dry_run',
      'billing.invoice.view',
    ],

    // Narrow scope for external usage-ingestion API keys.
    billing_usage_writer: ['billing.usage.ingest'],
  },

  /**
   * Tenant init: per-tenant module configs (cron, invoice number defaults).
   * Runs inside `setupInitialTenant()`, always — no `--no-examples` gate.
   */
  async onTenantCreated({ em }) {
    await seedBillingConfigs(em)
  },

  /**
   * Reference data: dictionaries (UoM, invoice statuses). Always runs
   * during `mercato init`. Idempotent — re-seed is safe.
   */
  async seedDefaults({ em, tenantId, organizationId }) {
    const scope = { tenantId, organizationId }
    await seedBillingUomDictionary(em, scope)
    await seedInvoiceStatusDictionary(em, scope)
  },
}

export default setup
