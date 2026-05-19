import type { EntityManager } from '@mikro-orm/postgresql'
import {
  Dictionary,
  DictionaryEntry,
} from '@open-mercato/core/modules/dictionaries/data/entities'
import type { InvoiceStatus } from '../data/validators'

/**
 * Resolve the `sales.invoice_status` dictionary entry id for a given
 * status value, scoped per `(tenantId, organizationId)`.
 *
 * Used by:
 *   - `invoiceWriter` to set `statusEntryId` on the draft at create time.
 *   - The "post" command to flip draft → posted.
 *   - The payment-captured subscriber to flip posted → paid.
 *
 * Cached because the lookup is hot (every Bill Run draft hits it
 * once, every posted invoice hits it twice, every paid invoice once)
 * and the dictionary entry id never changes for the lifetime of a
 * tenant. Exposed `__resetInvoiceStatusCacheForTests` to keep tests
 * deterministic across runs.
 */

const SALES_INVOICE_STATUS_DICTIONARY_KEY = 'sales.invoice_status'

const cache = new Map<string, string>()

function key(tenantId: string, organizationId: string, status: InvoiceStatus): string {
  return `${tenantId}:${organizationId}:${status}`
}

export async function resolveInvoiceStatusEntryId(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  status: InvoiceStatus,
): Promise<string | null> {
  const cacheKey = key(tenantId, organizationId, status)
  const cached = cache.get(cacheKey)
  if (cached) return cached
  const dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: SALES_INVOICE_STATUS_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (!dictionary) return null
  const entry = await em.findOne(DictionaryEntry, {
    dictionary,
    tenantId,
    organizationId,
    value: status,
  })
  if (!entry) return null
  cache.set(cacheKey, entry.id)
  return entry.id
}

export function __resetInvoiceStatusCacheForTests(): void {
  cache.clear()
}
