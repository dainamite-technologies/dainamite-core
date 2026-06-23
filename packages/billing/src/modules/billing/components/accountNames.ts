import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Batch-resolve billing account ids → display names for list views that only
 * carry the FK (`bill_account_id`). One request per page (≤100 ids via the
 * CRUD factory's `ids` filter) — never a per-row fetch.
 */
export async function fetchAccountNames(ids: Array<string | null | undefined>): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)))
  if (!unique.length) return {}
  const map: Record<string, string> = {}
  // The factory caps page sizes; chunk to stay within the 100 limit.
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const result = await readApiResultOrThrow<{ items: Array<{ id: string; name: string }> }>(
      `/api/billing/accounts?ids=${chunk.join(',')}&pageSize=${chunk.length}`,
    )
    for (const a of result.items ?? []) {
      if (a?.id) map[a.id] = a.name ?? a.id
    }
  }
  return map
}
