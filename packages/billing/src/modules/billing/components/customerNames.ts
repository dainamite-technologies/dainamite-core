import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CustomerKind } from '../data/validators'
import {
  customerEndpoint,
  extractItems,
  planCustomerLookups,
  toCustomerSummary,
  type CustomerSummary,
} from '../lib/customerLookup'

/**
 * Batch-resolve customer ids → display names for billing list / detail
 * views. One request per kind per ≤100 ids (CRUD factory `ids` filter) —
 * never a per-row fetch.
 *
 * Soft dependency on the customers module: a failed or missing lookup just
 * leaves the id unresolved, and callers fall back to showing the raw id.
 */
export async function fetchCustomerNames(
  rows: Array<{ customerId: string | null | undefined; customerKind: CustomerKind | null | undefined }>,
): Promise<Record<string, CustomerSummary>> {
  const plan = planCustomerLookups(rows)
  const results = await Promise.all(
    plan.map(async ({ kind, ids }) => {
      const params = new URLSearchParams({ ids: ids.join(','), page: '1', pageSize: String(ids.length) })
      return safeList(`${customerEndpoint(kind)}?${params.toString()}`)
    }),
  )
  const map: Record<string, CustomerSummary> = {}
  for (const rowsOfKind of results) {
    for (const raw of rowsOfKind) {
      const summary = toCustomerSummary(raw)
      if (summary) map[summary.id] = summary
    }
  }
  return map
}

/**
 * Loads the customer's addresses and returns the raw rows (the caller maps
 * them with `mapPrimaryAddress`). Empty on any failure — prefill is a
 * convenience, never a blocker.
 */
export async function fetchCustomerAddressRows(customerId: string): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({ entityId: customerId, page: '1', pageSize: '20' })
  return safeList(`/api/customers/addresses?${params.toString()}`)
}

/**
 * GET a customers list endpoint; any failure (non-2xx, network error, module
 * not installed) yields an empty list. These lookups are cosmetic — the
 * caller falls back to the raw id / no prefill — so they must never reject.
 */
async function safeList(url: string): Promise<Array<Record<string, unknown>>> {
  try {
    const call = await apiCall<unknown>(url)
    return call.ok ? extractItems(call.result) : []
  } catch (err) {
    console.warn('[billing] customer lookup failed', url, err)
    return []
  }
}
