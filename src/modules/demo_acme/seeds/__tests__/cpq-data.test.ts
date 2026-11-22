import {
  ACME_ATTRIBUTES,
  ACME_BUNDLE_OFFERING,
  ACME_CHARGES,
  ACME_MARKER_SKU,
  ACME_OFFERINGS,
  ACME_PRODUCTS,
  ACME_SLOTS,
  ACME_SPECS,
} from '../cpq-data'
import { ACME_ACCOUNTS } from '../billing-data'

const skus = ACME_PRODUCTS.map((p) => p.sku)
const specCodes = ACME_SPECS.map((s) => s.code)
const offeringCodes = ACME_OFFERINGS.map((o) => o.code)

describe('ACME CPQ data', () => {
  it('codes and SKUs are unique', () => {
    for (const list of [skus, specCodes, offeringCodes, ACME_CHARGES.map((c) => c.code)]) {
      expect(new Set(list).size).toBe(list.length)
    }
    expect(skus).toContain(ACME_MARKER_SKU)
  })

  it('every reference points at a defined product / spec / offering', () => {
    ACME_SPECS.forEach((s) => expect(skus).toContain(s.productSku))
    ACME_ATTRIBUTES.forEach((a) => expect(specCodes).toContain(a.specCode))
    ACME_OFFERINGS.forEach((o) => expect(specCodes).toContain(o.specCode))
    ACME_CHARGES.forEach((c) => {
      expect(offeringCodes).toContain(c.offeringCode)
      expect(skus).toContain(c.productSku)
    })
    ACME_SLOTS.forEach((slot) => {
      expect(specCodes).toContain(slot.bundleSpecCode)
      expect(specCodes).toContain(slot.targetSpecCode)
      expect(offeringCodes).toContain(slot.defaultOfferingCode)
    })
  })

  it('each slot default offering belongs to the slot target spec, and the bundle offering is on a bundle spec', () => {
    for (const slot of ACME_SLOTS) {
      expect(ACME_OFFERINGS.find((o) => o.code === slot.defaultOfferingCode)!.specCode).toBe(slot.targetSpecCode)
    }
    const bundle = ACME_OFFERINGS.find((o) => o.code === ACME_BUNDLE_OFFERING)!
    expect(bundle.offeringType).toBe('bundle')
    expect(ACME_SPECS.find((s) => s.code === bundle.specCode)!.specType).toBe('bundle')
  })

  it('design-time values are options of the spec attribute', () => {
    const bandwidth = ACME_ATTRIBUTES.find((a) => a.code === 'bandwidth')!
    const allowed = bandwidth.options.map((o) => o.value)
    ACME_OFFERINGS.filter((o) => o.specCode === bandwidth.specCode).forEach((o) =>
      expect(allowed).toContain(o.designTimeValues.bandwidth),
    )
  })

  it('the CPQ-sourced billing account carries no items of its own (the connector creates them)', () => {
    const cpqAccounts = ACME_ACCOUNTS.filter((a) => a.fromCpq)
    expect(cpqAccounts.map((a) => a.key)).toEqual(['brightside'])
    cpqAccounts.forEach((a) => {
      expect(a.items).toEqual([])
      expect(a.steps.every((s) => s.kind === 'run')).toBe(true)
    })
  })
})
