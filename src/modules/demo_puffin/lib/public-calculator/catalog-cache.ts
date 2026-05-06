/**
 * Shared in-memory cache for the public catalog. Both the `/catalog` route
 * and the offering allowlist (used by `/price`, `/attributes`, `/quotes`)
 * consume from here so a single cold load primes everything for 60s.
 *
 * The cache stores both the assembled `PublicCatalog` payload and the
 * `listedInCalculator` allowlist extracted from the same hydrate pass — the
 * allowlist used to fetch its own (broken) list-only view, double-spending
 * DB connections and silently filtering everything out because the CPQ list
 * endpoint omits `metadata`.
 */

import type { PuffinPublicConfig } from './env'
import { proxyClient } from './proxy-client'
import {
  buildPublicCatalog,
  type PublicCatalog,
  type RawOffering,
  type RawSpecification,
} from './catalog-filter'
import { REGIONS } from '../../seeds/data/products'

const PAGE_SIZE = 100
const CACHE_TTL_MS = 60_000

type CatalogSnapshot = {
  catalog: PublicCatalog
  /** Offering IDs that survived the listedInCalculator + active filter. */
  listedIds: Set<string>
  /** offeringId → CpqProductOffering.code for every hydrated offering. The
   *  public /price route uses this to inject `offering_code` into each item's
   *  configuration so dimensioned pricing tables (e.g. workspace per-seat,
   *  block storage per-GB) can match a row by offering. */
  offeringCodes: Map<string, string>
}

type Cached = {
  snapshot: CatalogSnapshot
  expiresAt: number
}

let cached: Cached | null = null
let inFlight: Promise<CatalogSnapshot> | null = null

async function fetchAllOfferings(config: PuffinPublicConfig): Promise<RawOffering[]> {
  const items: RawOffering[] = []
  let page = 1
  while (true) {
    const result = await proxyClient.get<{ items?: RawOffering[]; totalPages?: number }>(
      config,
      '/api/cpq/product-offerings',
      { page, pageSize: PAGE_SIZE },
    )
    if (!result.ok) throw new Error(`offerings_list_failed:${result.status}`)
    const list = result.data.items ?? []
    items.push(...list)
    const totalPages = result.data.totalPages ?? 1
    if (page >= totalPages || list.length < PAGE_SIZE) break
    page += 1
  }
  return items
}

async function fetchAllSpecs(config: PuffinPublicConfig): Promise<RawSpecification[]> {
  const items: RawSpecification[] = []
  let page = 1
  while (true) {
    const result = await proxyClient.get<{ items?: RawSpecification[]; totalPages?: number }>(
      config,
      '/api/cpq/product-specifications',
      { page, pageSize: PAGE_SIZE },
    )
    if (!result.ok) throw new Error(`specs_list_failed:${result.status}`)
    const list = result.data.items ?? []
    items.push(...list)
    const totalPages = result.data.totalPages ?? 1
    if (page >= totalPages || list.length < PAGE_SIZE) break
    page += 1
  }
  return items
}

async function hydrateOffering(config: PuffinPublicConfig, id: string): Promise<RawOffering | null> {
  const result = await proxyClient.get<RawOffering>(
    config,
    '/api/cpq/product-offerings',
    { id },
  )
  if (result.ok && result.data && (result.data as RawOffering).id) {
    return result.data as RawOffering
  }
  return null
}

async function buildSnapshot(config: PuffinPublicConfig): Promise<CatalogSnapshot> {
  // Sequential — each loopback HTTP spawns its own DI container with a
  // fresh DB connection; small dev pools choke if we go parallel.
  const offeringsList = await fetchAllOfferings(config)
  const specsList = await fetchAllSpecs(config)

  const hydrated: RawOffering[] = []
  let hydrateFailures = 0
  for (const offering of offeringsList) {
    const detail = await hydrateOffering(config, offering.id)
    if (detail) {
      hydrated.push(detail)
    } else {
      // CPQ's per-id detail endpoint can 500 on bundle offerings (current
      // known issue). The list response carries no `metadata`, so the
      // listedInCalculator filter would silently drop these. Synthesize a
      // permissive metadata block matching puffin's seed default
      // (`listedInCalculator: true`) so bundles still surface — admins who
      // explicitly hide an offering rely on a successful hydrate, which
      // works for non-bundle offerings.
      hydrateFailures += 1
      hydrated.push({
        ...offering,
        metadata: { listedInCalculator: true, _hydrateFailed: true },
      } as RawOffering)
    }
  }
  if (hydrateFailures > 0) {
    console.warn(
      `[puffin-public-calculator] catalog: ${hydrateFailures}/${offeringsList.length} offering details failed to hydrate; using list-response fallback with permissive listedInCalculator default`,
    )
  }

  const catalog = buildPublicCatalog({
    specifications: specsList,
    offerings: hydrated,
    regions: REGIONS.map((r) => ({ value: r.value, label: r.label })),
    currencyCode: 'USD',
  })

  // Extract the listedInCalculator allowlist from the same hydrated set so
  // /price + /attributes + /quotes use the exact offering IDs that survived
  // the catalog filter (no double-spent connections, no drift).
  const listedIds = new Set<string>()
  const offeringCodes = new Map<string, string>()
  for (const offering of hydrated) {
    if (offering.code) offeringCodes.set(offering.id, offering.code)
    if (offering.metadata?.listedInCalculator !== true) continue
    if (offering.lifecycleStatus !== 'active') continue
    if (offering.isActive === false) continue
    listedIds.add(offering.id)
  }

  return { catalog, listedIds, offeringCodes }
}

export async function getCatalogSnapshot(config: PuffinPublicConfig): Promise<CatalogSnapshot> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.snapshot
  if (inFlight) return inFlight

  inFlight = buildSnapshot(config)
    .then((snapshot) => {
      cached = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS }
      return snapshot
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export async function getCachedCatalog(config: PuffinPublicConfig): Promise<PublicCatalog> {
  return (await getCatalogSnapshot(config)).catalog
}

export async function getListedOfferingIds(config: PuffinPublicConfig): Promise<Set<string>> {
  return (await getCatalogSnapshot(config)).listedIds
}

export async function getOfferingCodeMap(config: PuffinPublicConfig): Promise<Map<string, string>> {
  return (await getCatalogSnapshot(config)).offeringCodes
}

export function getStaleCatalogIfAny(): PublicCatalog | null {
  return cached?.snapshot.catalog ?? null
}

export function _resetCatalogCacheForTests(): void {
  cached = null
  inFlight = null
}
