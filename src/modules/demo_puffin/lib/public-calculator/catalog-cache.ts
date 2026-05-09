/**
 * Shared in-memory cache for the public catalog. Both the `/catalog` route
 * and the offering allowlist (used by `/price`, `/attributes`, `/quotes`)
 * consume from here so a single cold load primes everything.
 *
 * Data is loaded directly from the DB via MikroORM (5 batched SELECTs), not
 * via loopback HTTP. The previous implementation paginated `/api/cpq/...`
 * endpoints and made a per-id detail call for every offering — N+3 loopback
 * HTTPs per cold rebuild, each spawning its own DI container with a fresh
 * DB connection while the parent request held its own. With even a small
 * pool that pattern saturated Postgres `max_connections` and cascaded into
 * `/api/auth/login` 500s.
 *
 * Direct-DB reads collapse the cold path to 5 queries on a single forked EM,
 * eliminating the loopback fan-out entirely.
 *
 * Cache semantics: stale-while-revalidate. Once a snapshot has been built,
 * expired requests return the stale copy immediately and a single background
 * refresh runs to replace it. Cold start (no snapshot at all) still awaits
 * the build.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import {
  CpqProductOffering,
  CpqProductSpecification,
  CpqProductCharge,
  CpqOfferingComponent,
  CpqBundleSlot,
} from '@dainamite/cpq/modules/cpq/data/entities'
import type { PuffinPublicConfig } from './env'
import {
  buildPublicCatalog,
  type PublicCatalog,
  type RawOffering,
  type RawSpecification,
} from './catalog-filter'
import { REGIONS } from '../../seeds/data/products'
import { resolvePuffinTenantContext } from './tenant-context'

const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

type CatalogSnapshot = {
  catalog: PublicCatalog
  /** Offering IDs that survived the listedInCalculator + active filter. */
  listedIds: Set<string>
  /** offeringId → CpqProductOffering.code for every loaded offering. The
   *  public /price route uses this to inject `offering_code` into each item's
   *  configuration so dimensioned pricing tables (e.g. workspace per-seat,
   *  block storage per-GB) can match a row by offering. */
  offeringCodes: Map<string, string>
}

type Cached = {
  snapshot: CatalogSnapshot
  expiresAt: number
}

/** Output of the data loader: shaped exactly like what `buildPublicCatalog`
 *  expects. The loader is the seam tests use to bypass the DB. */
export type CatalogRawData = {
  offerings: RawOffering[]
  specifications: RawSpecification[]
}

export type CatalogDataLoader = (config: PuffinPublicConfig) => Promise<CatalogRawData>

let cached: Cached | null = null
let inFlight: Promise<CatalogSnapshot> | null = null
let dataLoader: CatalogDataLoader = defaultDirectDbLoader

async function defaultDirectDbLoader(config: PuffinPublicConfig): Promise<CatalogRawData> {
  const orm = await getOrm()
  const em = orm.em.fork({ clear: true }) as unknown as EntityManager
  const { organizationId, tenantId } = await resolvePuffinTenantContext(em, config.adminEmail)
  const scope = { organizationId, tenantId, deletedAt: null }

  // 5 batched SELECTs replace ~33 loopback HTTPs.
  const [offerings, specifications, charges, components, slots] = await Promise.all([
    em.find(CpqProductOffering, scope),
    em.find(CpqProductSpecification, scope),
    em.find(
      CpqProductCharge,
      { ...scope, offeringId: { $ne: null } },
      { orderBy: { sortOrder: 'asc' } },
    ),
    em.find(CpqOfferingComponent, scope, { orderBy: { sortOrder: 'asc' } }),
    em.find(CpqBundleSlot, scope),
  ])

  const chargesByOffering = new Map<string, CpqProductCharge[]>()
  for (const charge of charges) {
    if (!charge.offeringId) continue
    const list = chargesByOffering.get(charge.offeringId) ?? []
    list.push(charge)
    chargesByOffering.set(charge.offeringId, list)
  }

  const slotById = new Map<string, CpqBundleSlot>()
  for (const slot of slots) slotById.set(slot.id, slot)

  const offeringById = new Map<string, CpqProductOffering>()
  for (const offering of offerings) offeringById.set(offering.id, offering)

  const componentsByOffering = new Map<string, CpqOfferingComponent[]>()
  for (const component of components) {
    const list = componentsByOffering.get(component.offeringId) ?? []
    list.push(component)
    componentsByOffering.set(component.offeringId, list)
  }

  const rawOfferings: RawOffering[] = offerings.map((offering) => {
    const offeringCharges = chargesByOffering.get(offering.id) ?? []
    const isBundle = offering.offeringType === 'bundle'
    const offeringComponents = isBundle
      ? (componentsByOffering.get(offering.id) ?? []).map((c) => {
          const slot = slotById.get(c.slotId)
          const child = offeringById.get(c.childOfferingId)
          return {
            id: c.id,
            slotId: c.slotId,
            slot: slot
              ? {
                  id: slot.id,
                  componentGroup: slot.componentGroup,
                  name: slot.name,
                  cardinalityMin: slot.cardinalityMin,
                  cardinalityMax: slot.cardinalityMax,
                }
              : null,
            childOfferingId: c.childOfferingId,
            childOffering: child
              ? {
                  id: child.id,
                  code: child.code,
                  name: child.name,
                  offeringType: child.offeringType,
                  specId: child.specId,
                }
              : null,
            isDefault: c.isDefault,
            sortOrder: c.sortOrder,
            isActive: c.isActive,
          }
        })
      : null
    return {
      id: offering.id,
      specId: offering.specId,
      code: offering.code,
      name: offering.name,
      description: offering.description ?? null,
      offeringType: offering.offeringType,
      designTimeValues: (offering.designTimeValues ?? null) as Record<string, unknown> | null,
      lifecycleStatus: offering.lifecycleStatus,
      metadata: (offering.metadata ?? null) as Record<string, unknown> | null,
      charges: offeringCharges.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        description: c.description ?? null,
        chargeType: c.chargeType,
        pricingMethod: c.pricingMethod,
        pricingTableId: c.pricingTableId ?? null,
        priceColumnKey: c.priceColumnKey ?? null,
        fixedPrice: c.fixedPrice ?? null,
        currencyCode: c.currencyCode ?? null,
        quantityAttributeCode: c.quantityAttributeCode ?? null,
        applicabilityCondition: (c.applicabilityCondition ?? null) as Record<string, unknown> | null,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
      })),
      components: offeringComponents,
      isActive: offering.isActive,
    }
  })

  const rawSpecs: RawSpecification[] = specifications.map((spec) => ({
    id: spec.id,
    productId: spec.productId,
    code: spec.code,
    name: spec.name,
    description: spec.description ?? null,
    specType: spec.specType,
    metadata: (spec.metadata ?? null) as Record<string, unknown> | null,
    isActive: spec.isActive,
    // Per existing behavior the catalog cache never loaded spec attributes/slots
    // for the public catalog payload; the frontend tolerates empty arrays.
    attributes: undefined,
    slots: undefined,
  }))

  return { offerings: rawOfferings, specifications: rawSpecs }
}

async function buildSnapshot(config: PuffinPublicConfig): Promise<CatalogSnapshot> {
  const { offerings, specifications } = await dataLoader(config)

  const catalog = buildPublicCatalog({
    specifications,
    offerings,
    regions: REGIONS.map((r) => ({ value: r.value, label: r.label })),
    currencyCode: 'USD',
  })

  const listedIds = new Set<string>()
  const offeringCodes = new Map<string, string>()
  for (const offering of offerings) {
    if (offering.code) offeringCodes.set(offering.id, offering.code)
    if (offering.metadata?.listedInCalculator !== true) continue
    if (offering.lifecycleStatus !== 'active') continue
    if (offering.isActive === false) continue
    listedIds.add(offering.id)
  }

  return { catalog, listedIds, offeringCodes }
}

function startBackgroundRefresh(config: PuffinPublicConfig): void {
  if (inFlight) return
  inFlight = buildSnapshot(config)
    .then((snapshot) => {
      cached = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS }
      return snapshot
    })
    .catch((err) => {
      // Background refresh failed — keep serving the stale snapshot. The next
      // request will try again. Without this catch the rejection would
      // surface as an unhandled promise.
      console.warn('[puffin-public-calculator] background catalog refresh failed:', err)
      if (cached) return cached.snapshot
      throw err
    })
    .finally(() => {
      inFlight = null
    }) as Promise<CatalogSnapshot>
}

export async function getCatalogSnapshot(config: PuffinPublicConfig): Promise<CatalogSnapshot> {
  const now = Date.now()
  if (cached) {
    if (cached.expiresAt > now) return cached.snapshot
    // Stale — return immediately and refresh in background. Concurrent stale
    // requests share the single in-flight refresh.
    startBackgroundRefresh(config)
    return cached.snapshot
  }
  // Cold start — must wait for the first build.
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

/**
 * Tests inject a fake loader so they don't need a real ORM/DB. Production
 * code uses `defaultDirectDbLoader`.
 */
export function _setCatalogDataLoaderForTests(loader: CatalogDataLoader | null): void {
  dataLoader = loader ?? defaultDirectDbLoader
}

export function _resetCatalogCacheForTests(): void {
  cached = null
  inFlight = null
}
