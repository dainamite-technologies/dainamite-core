import { ALL_PRODUCTS, VPS, WORKSPACE } from '../seeds/data/products'
import { DEFAULT_PUBLIC_CALCULATOR_FEATURE } from '../setup'

/**
 * XD-275 phase 5 (light touch in XD-276) — every Puffin offering must be
 * flagged for the public pricing calculator unless it explicitly opts out.
 *
 * The seeder writes `listedInCalculator` into `CpqProductOffering.metadata`.
 * Here we verify the source-of-truth product definitions either set the
 * flag explicitly to `true` or leave it undefined (defaults to true at
 * seed time per `seedPuffinProducts`).
 */
describe('Puffin calculator metadata', () => {
  it('every offering across every product is calculator-listed by default', () => {
    for (const product of ALL_PRODUCTS) {
      for (const offering of product.offerings) {
        // Either explicitly true, or undefined (default-true) — never false.
        expect(offering.listedInCalculator).not.toBe(false)
      }
    }
  })

  it('VPS offerings are all calculator-listed', () => {
    for (const offer of VPS.offerings) {
      expect(offer.listedInCalculator !== false).toBe(true)
    }
  })

  it('Workspace add-ons remain calculator-listed (they attach to a parent line)', () => {
    const addOnCodes = ['ws_email_archive', 'ws_atp', 'ws_extra_storage', 'ws_compliance']
    for (const code of addOnCodes) {
      const offer = WORKSPACE.offerings.find((o) => o.code === code)
      expect(offer).toBeDefined()
      expect(offer!.listedInCalculator !== false).toBe(true)
    }
  })

  it('exposes the public-calculator feature id from setup', () => {
    expect(DEFAULT_PUBLIC_CALCULATOR_FEATURE).toBe('cpq.public.calculator')
  })
})
