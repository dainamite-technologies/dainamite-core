/**
 * ACME (primary tenant) CPQ demo data — a replay of a hand-made demo session,
 * captured 2026-11-18. Pure data; `./cpq.ts` writes the catalog and replays
 * the quote → order → activation through the CPQ services.
 *
 * Catalog: one configurable "Internet Service" (three bandwidth offerings,
 * each with a monthly fee + setup fee), an assetizable "ONT Device", and an
 * "Internet Family Bundle" with one Internet slot and one Device slot.
 */

export type AcmeProduct = { sku: string; handle: string; title: string }

export type AcmeSpec = {
  code: string
  productSku: string
  name: string
  specType: 'simple' | 'bundle'
  isAssetizable: boolean
}

export type AcmeAttribute = {
  specCode: string
  code: string
  name: string
  attributeType: 'select'
  options: Array<{ label: string; value: string }>
  isRequired: boolean
  resolutionTime: 'design_time'
}

export type AcmeOffering = {
  code: string
  specCode: string
  name: string
  offeringType: 'simple' | 'bundle'
  designTimeValues: Record<string, unknown>
}

export type AcmeCharge = {
  code: string
  offeringCode: string
  productSku: string
  name: string
  chargeType: 'mrc' | 'nrc'
  fixedPrice: string
}

export type AcmeSlot = {
  key: string
  bundleSpecCode: string
  targetSpecCode: string
  name: string
  componentGroup: string
  sortOrder: number
  defaultOfferingCode: string
}

export const ACME_PRODUCTS: AcmeProduct[] = [
  { sku: 'INTERNET', handle: 'internet', title: 'Internet Service' },
  { sku: 'ONT', handle: 'ont', title: 'ONT Device' },
  { sku: 'INTERNET-BUNDLE', handle: 'internet-bundle', title: 'Internet Bundle' },
]

/** Seeding marker: present → the ACME demo was already seeded in this organization. */
export const ACME_MARKER_SKU = 'INTERNET-BUNDLE'

export const ACME_SPECS: AcmeSpec[] = [
  { code: 'internet', productSku: 'INTERNET', name: 'Internet Service', specType: 'simple', isAssetizable: false },
  { code: 'ont', productSku: 'ONT', name: 'ONT Device', specType: 'simple', isAssetizable: true },
  { code: 'internet-bundle', productSku: 'INTERNET-BUNDLE', name: 'Internet Bundle', specType: 'bundle', isAssetizable: false },
]

export const ACME_ATTRIBUTES: AcmeAttribute[] = [
  {
    specCode: 'internet',
    code: 'bandwidth',
    name: 'Bandwidth',
    attributeType: 'select',
    options: [
      { label: '100Mbps', value: '100mb' },
      { label: '300Mbps', value: '300mb' },
      { label: '600Mbps', value: '600mb' },
    ],
    isRequired: true,
    resolutionTime: 'design_time',
  },
]

export const ACME_OFFERINGS: AcmeOffering[] = [
  { code: 'internet-100', specCode: 'internet', name: 'Internet Service - 100Mbps', offeringType: 'simple', designTimeValues: { bandwidth: '100mb' } },
  { code: 'internet-300', specCode: 'internet', name: 'Internet Service - 300Mbps', offeringType: 'simple', designTimeValues: { bandwidth: '300mb' } },
  { code: 'internet-600', specCode: 'internet', name: 'Internet Service - 600Mbps', offeringType: 'simple', designTimeValues: { bandwidth: '600mb' } },
  { code: 'ont-device', specCode: 'ont', name: 'ONT', offeringType: 'simple', designTimeValues: {} },
  { code: 'internet-family-bundle', specCode: 'internet-bundle', name: 'Internet Family Bundle', offeringType: 'bundle', designTimeValues: {} },
]

// Monthly fees as configured in the original session (the faster plans are cheaper).
const MONTHLY_FEE: Record<string, string> = { '100': '120', '300': '90', '600': '60' }

export const ACME_CHARGES: AcmeCharge[] = (['100', '300', '600'] as const).flatMap((speed) => [
  {
    code: `internet-${speed}--mrc`,
    offeringCode: `internet-${speed}`,
    productSku: 'INTERNET',
    name: 'Monthly Subscription Fee',
    chargeType: 'mrc' as const,
    fixedPrice: MONTHLY_FEE[speed],
  },
  {
    code: `internet-${speed}--nrc`,
    offeringCode: `internet-${speed}`,
    productSku: 'INTERNET',
    name: 'Setup Fee',
    chargeType: 'nrc' as const,
    fixedPrice: '100',
  },
])

export const ACME_SLOTS: AcmeSlot[] = [
  {
    key: 'internet',
    bundleSpecCode: 'internet-bundle',
    targetSpecCode: 'internet',
    name: 'Internet Service',
    componentGroup: 'Internet',
    sortOrder: 1,
    defaultOfferingCode: 'internet-600',
  },
  {
    key: 'device',
    bundleSpecCode: 'internet-bundle',
    targetSpecCode: 'ont',
    name: 'Device',
    componentGroup: 'device',
    sortOrder: 2,
    defaultOfferingCode: 'ont-device',
  },
]

export const ACME_BUNDLE_OFFERING = 'internet-family-bundle'

/**
 * Quotes for Brightside Solar:
 *  - the Internet Family Bundle (600 Mbps + ONT), accepted → order → billing
 *    setup (new account, bill on the 18th) → activated → subscription active;
 *  - a second, empty quote left in `new`.
 */
export const ACME_CPQ_CUSTOMER = 'Brightside Solar'
export const ACME_CPQ_CURRENCY = 'USD'
export const ACME_CPQ_BILL_DAY = 18
