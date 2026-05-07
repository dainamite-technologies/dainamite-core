/**
 * Server-side filter that turns the authenticated CPQ catalog responses into
 * the *public* shape exposed by the Puffin calculator.
 *
 * Responsibilities:
 *   - Drop offerings whose `metadata.listedInCalculator` is not strictly true.
 *   - Drop offerings whose `lifecycleStatus` is not `'active'`.
 *   - Strip every metadata key that could leak internal data (cost, margin,
 *     vendor, anything starting with `_internal_`).
 *   - Compute a `fromPriceMonthly` per spec from offering charges so the
 *     catalog grid can render a "from $X / mo" tagline without a /price call.
 *   - Group offerings by specification + tag the spec with a `uiPattern`
 *     hint so the frontend can mount the right line component.
 */

const INTERNAL_METADATA_PREFIXES = ['_internal_']
const INTERNAL_METADATA_KEYS = new Set([
  'cost',
  'costAmount',
  'margin',
  'marginPercent',
  'vendor',
  'vendorCode',
  'vendorContractId',
  'internalNotes',
])

/** Strip metadata fields that should never reach a public visitor. */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (INTERNAL_METADATA_KEYS.has(key)) continue
    if (key.toLowerCase().includes('cost')) continue
    if (key.toLowerCase().includes('margin')) continue
    if (key.toLowerCase().includes('vendor')) continue
    if (INTERNAL_METADATA_PREFIXES.some((p) => key.startsWith(p))) continue
    out[key] = value
  }
  return out
}

export function isListedInCalculator(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  return metadata.listedInCalculator === true
}

export type RawCharge = {
  id: string
  code: string
  name: string
  description: string | null
  chargeType: string
  pricingMethod: string
  pricingTableId: string | null
  priceColumnKey: string | null
  fixedPrice: string | number | null
  currencyCode: string | null
  quantityAttributeCode: string | null
  applicabilityCondition: Record<string, unknown> | null
  sortOrder: number
  isActive: boolean
}

export type RawOffering = {
  id: string
  specId: string
  code: string
  name: string
  description: string | null
  offeringType: 'simple' | 'bundle' | string
  designTimeValues: Record<string, unknown> | null
  lifecycleStatus: string
  metadata?: Record<string, unknown> | null
  charges?: RawCharge[]
  components?: Array<Record<string, unknown>> | null
  isActive: boolean
}

export type RawSpecification = {
  id: string
  productId: string
  code: string
  name: string
  description: string | null
  specType: 'simple' | 'bundle' | string
  metadata?: Record<string, unknown> | null
  isActive: boolean
  attributes?: Array<Record<string, unknown>> | null
  slots?: Array<Record<string, unknown>> | null
}

export type PublicOffering = {
  id: string
  specId: string
  code: string
  marketingName: string
  description: string | null
  offeringType: string
  fromPriceMonthly: number | null
  fromPriceOneTime: number | null
  designTimeValues: Record<string, unknown>
  metadata: Record<string, unknown>
  charges: PublicCharge[]
  components?: Array<Record<string, unknown>> | null
}

export type PublicCharge = {
  code: string
  name: string
  description: string | null
  chargeType: string
  pricingMethod: string
  fixedPrice: number | null
  currencyCode: string | null
  sortOrder: number
  quantityAttributeCode: string | null
}

export type PublicSpecification = {
  id: string
  code: string
  name: string
  tagline: string | null
  specType: string
  uiPattern: string
  attributes: Array<Record<string, unknown>>
  slots: Array<Record<string, unknown>>
  offerings: PublicOffering[]
}

function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  const num = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(num) ? num : null
}

function sanitizeCharge(charge: RawCharge): PublicCharge {
  return {
    code: charge.code,
    name: charge.name,
    description: charge.description,
    chargeType: charge.chargeType,
    pricingMethod: charge.pricingMethod,
    fixedPrice: parsePrice(charge.fixedPrice),
    currencyCode: charge.currencyCode,
    sortOrder: charge.sortOrder,
    quantityAttributeCode: charge.quantityAttributeCode,
  }
}

/**
 * Best-effort headline price for the catalogue grid. We only use deterministic
 * values: an explicit `mrc` / `nrc` on `designTimeValues`, or a flat `mrc`
 * fixedPrice on a charge. Tiered/usage charges fall back to null — the UI
 * shows "Configure to see pricing".
 */
function computeFromPrice(offering: RawOffering): { monthly: number | null; oneTime: number | null } {
  // The puffin seed writes designTimeValues into BOTH the entity column AND
  // metadata.designTimeValues (the latter is what currently survives the
  // seeder); we read both so we don't depend on which one made it through.
  const topDtv = offering.designTimeValues ?? {}
  const metaDtvRaw = (offering.metadata as Record<string, unknown> | null | undefined)?.designTimeValues
  const metaDtv = (metaDtvRaw && typeof metaDtvRaw === 'object' ? metaDtvRaw : {}) as Record<string, unknown>

  const pickNumber = (key: string): number | null => {
    const fromTop = topDtv[key]
    if (typeof fromTop === 'number') return fromTop
    const fromMeta = metaDtv[key]
    if (typeof fromMeta === 'number') return fromMeta
    return null
  }

  const dtvMrc = pickNumber('mrc')
  const dtvNrc = pickNumber('nrc')
  // Bundles ship an `indicative_mrc` rather than a flat charge — surface it
  // so the bundle cards don't all read "Custom".
  const indicative = pickNumber('indicative_mrc')

  let monthly = dtvMrc ?? indicative
  let oneTime = dtvNrc

  if (offering.charges && (monthly == null || oneTime == null)) {
    for (const charge of offering.charges) {
      if (!charge.isActive) continue
      const fixed = parsePrice(charge.fixedPrice)
      if (fixed == null) continue
      if (charge.chargeType === 'mrc' && charge.pricingMethod === 'flat' && monthly == null) {
        monthly = fixed
      } else if (charge.chargeType === 'nrc' && charge.pricingMethod === 'flat' && oneTime == null) {
        oneTime = fixed
      }
    }
  }

  return { monthly, oneTime }
}

const UI_PATTERN_BY_SPEC_CODE: Record<string, string> = {
  'SPEC-PUFFIN-VPS': 'plan_grid',
  'SPEC-PUFFIN-COMPUTE': 'compute_picker',
  'SPEC-PUFFIN-MANAGED-DB': 'managed_db_configurator',
  'SPEC-PUFFIN-WORKSPACE': 'workspace_picker',
  'SPEC-PUFFIN-PREMIUM-SUPPORT': 'premium_support_breakdown',
  'SPEC-PUFFIN-CDN': 'tiered_slider',
  'SPEC-PUFFIN-OBJECT-STORAGE': 'tiered_slider',
  'SPEC-PUFFIN-BANDWIDTH': 'tiered_slider',
  'SPEC-PUFFIN-DDOS': 'three_tier_compare',
  'SPEC-PUFFIN-BLOCK-STORAGE': 'tiered_slider',
  'SPEC-PUFFIN-API-GATEWAY': 'plan_grid',
  'SPEC-PUFFIN-SUPPORT': 'plan_grid',
  'SPEC-PUFFIN-BUNDLE-DEV-APP': 'bundle_card',
  'SPEC-PUFFIN-BUNDLE-ECOMMERCE': 'bundle_card',
  'SPEC-PUFFIN-BUNDLE-BUSINESS-OFFICE': 'bundle_card',
}

function resolveUiPattern(spec: RawSpecification): string {
  if (spec.specType === 'bundle') return 'bundle_card'
  return UI_PATTERN_BY_SPEC_CODE[spec.code] ?? 'plan_grid'
}

export function filterPublicOfferings(offerings: RawOffering[]): PublicOffering[] {
  const out: PublicOffering[] = []
  for (const offering of offerings) {
    if (offering.lifecycleStatus !== 'active') continue
    if (!offering.isActive) continue
    if (!isListedInCalculator(offering.metadata)) continue
    const { monthly, oneTime } = computeFromPrice(offering)
    const metaDtvRaw = (offering.metadata as Record<string, unknown> | null | undefined)?.designTimeValues
    const metaDtv = (metaDtvRaw && typeof metaDtvRaw === 'object' ? metaDtvRaw : {}) as Record<string, unknown>
    const mergedDtv = { ...metaDtv, ...((offering.designTimeValues ?? {}) as Record<string, unknown>) }
    out.push({
      id: offering.id,
      specId: offering.specId,
      code: offering.code,
      marketingName: offering.name,
      description: offering.description,
      offeringType: offering.offeringType,
      fromPriceMonthly: monthly,
      fromPriceOneTime: oneTime,
      designTimeValues: mergedDtv,
      metadata: sanitizeMetadata(offering.metadata),
      charges: (offering.charges ?? []).filter((c) => c.isActive).map(sanitizeCharge),
      components: offering.components ?? undefined,
    })
  }
  return out
}

export type PublicCatalog = {
  tenantSlug: 'puffin'
  currencyCode: string
  regions: Array<{ code: string; label: string }>
  specifications: PublicSpecification[]
}

export type BuildPublicCatalogInput = {
  specifications: RawSpecification[]
  offerings: RawOffering[]
  regions: Array<{ value: string; label: string }>
  currencyCode: string
}

/**
 * Stitches specifications + offerings into the public catalog shape. Drops:
 *   - inactive specs
 *   - specs whose offerings are all filtered out (so the UI never renders an
 *     empty card)
 */
export function buildPublicCatalog(input: BuildPublicCatalogInput): PublicCatalog {
  const filteredOfferings = filterPublicOfferings(input.offerings)
  const offeringsBySpec = new Map<string, PublicOffering[]>()
  for (const offering of filteredOfferings) {
    const list = offeringsBySpec.get(offering.specId)
    if (list) list.push(offering)
    else offeringsBySpec.set(offering.specId, [offering])
  }

  const specs: PublicSpecification[] = []
  for (const spec of input.specifications) {
    if (!spec.isActive) continue
    const offerings = offeringsBySpec.get(spec.id) ?? []
    if (offerings.length === 0) continue
    const tagline = (spec.metadata as Record<string, unknown> | null | undefined)?.tagline
    specs.push({
      id: spec.id,
      code: spec.code,
      name: spec.name,
      tagline: typeof tagline === 'string' ? tagline : spec.description,
      specType: spec.specType,
      uiPattern: resolveUiPattern(spec),
      attributes: (spec.attributes ?? []) as Array<Record<string, unknown>>,
      slots: (spec.slots ?? []) as Array<Record<string, unknown>>,
      offerings,
    })
  }

  return {
    tenantSlug: 'puffin',
    currencyCode: input.currencyCode,
    regions: input.regions.map((r) => ({ code: r.value, label: r.label })),
    specifications: specs,
  }
}
