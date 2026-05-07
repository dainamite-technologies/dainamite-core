/**
 * Tenant-scoped allowlist of offerings flagged `listedInCalculator`. Backed
 * by the shared catalog snapshot cache so /price, /attributes, /quotes and
 * /catalog all share a single hydrate pass.
 */

import type { PuffinPublicConfig } from './env'
import { getListedOfferingIds as snapshotListedIds, _resetCatalogCacheForTests } from './catalog-cache'

export async function getListedOfferingIds(config: PuffinPublicConfig): Promise<Set<string>> {
  return snapshotListedIds(config)
}

export async function isOfferingListed(config: PuffinPublicConfig, offeringId: string): Promise<boolean> {
  const ids = await snapshotListedIds(config)
  return ids.has(offeringId)
}

export function _resetOfferingAllowlistForTests(): void {
  _resetCatalogCacheForTests()
}
