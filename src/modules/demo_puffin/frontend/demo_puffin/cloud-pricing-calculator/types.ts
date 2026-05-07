/**
 * Public types shared across the calculator UI. Mirrors the wire shapes
 * returned by `/api/demo_puffin/cloud-pricing-calculator/{catalog,price,...}`.
 */

export type CartItem = {
  lineKey: string
  offeringId: string
  configuration: Record<string, unknown>
  quantity: number
  parentLineKey: string | null
  bundleSlotKey?: string | null
}

export type Cart = {
  flow: 'solutions' | 'custom' | null
  region: string
  term: 'on_demand' | 'reserved_1y' | 'reserved_3y'
  cadence: 'monthly' | 'annual_prepay'
  fromBundle: string | null
  items: CartItem[]
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
  /** Configuration key whose value supplies the per-unit quantity for usage
   *  / per-unit charges (e.g. `monthly_egress_gb`, `seat_count`). The cart
   *  uses this to compute an estimated monthly usage subtotal alongside MRC. */
  quantityAttributeCode: string | null
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

export type PublicCatalog = {
  tenantSlug: 'puffin'
  currencyCode: string
  regions: Array<{ code: string; label: string }>
  specifications: PublicSpecification[]
}

export type PublicConfig = {
  currencyCode: string
  defaultRegion: string
  pricingDebounceMs: number
  captcha:
    | { provider: 'disabled' }
    | { provider: 'recaptcha_v3'; siteKey?: string }
}

export type PriceLine = {
  lineKey: string
  offeringId: string
  parentLineKey: string | null
  quantity: number
  charges: Array<{
    chargeCode: string
    chargeName: string
    chargeType: string
    pricingMethod: string
    unitPrice: number | null
    totalPrice: number | null
    note?: string
  }>
  nrcTotal: number
  mrcTotal: number
  usageCharges: Array<{ chargeCode: string; chargeName: string; unitPrice: number | null; note: string }>
}

/**
 * The seeded spec names ("Puffin VPS Specification", "Puffin Workspace
 * Specification", …) are useful in the backend admin UI but read as noise
 * to a public visitor. Strip the trailing " Specification" suffix wherever
 * the calculator renders a spec name.
 */
export function displaySpecName(name: string | null | undefined): string {
  if (!name) return ''
  return name.replace(/\s+Specification$/i, '')
}

export type PriceResponse = {
  currencyCode: string
  lines: PriceLine[]
  totals: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; chargeName: string; unitPrice: number | null; note: string }>
  }
  validationErrors: Array<{ lineKey: string; reason: string }>
  meta?: { durationMs: number; lineCount: number }
}
