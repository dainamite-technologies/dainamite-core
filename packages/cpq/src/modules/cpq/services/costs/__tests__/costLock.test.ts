import { affectsPrice, extendsValidity, isWriteRefused, type CostLockState } from '../costLock'

const basis: CostLockState = {
  role: 'price_basis', chargeCode: 'tail', costType: 'mrc', costModel: 'flat', source: 'on_request',
  unitAmount: '300.0000', currencyCode: 'EUR', valueStatus: 'estimated',
}
const marginOnly: CostLockState = { ...basis, role: 'margin_only', chargeCode: null }

describe('affectsPrice', () => {
  it('margin-only costs never affect the price', () => {
    expect(affectsPrice(null, marginOnly)).toBe(false)
    expect(affectsPrice(marginOnly, { ...marginOnly, unitAmount: '999' })).toBe(false)
    expect(affectsPrice(marginOnly, null)).toBe(false)
  })
  it('creating or deleting a price-basis cost affects the price', () => {
    expect(affectsPrice(null, basis)).toBe(true)
    expect(affectsPrice(basis, null)).toBe(true)
  })
  it('a value, currency, structure or role change affects the price', () => {
    expect(affectsPrice(basis, { ...basis, unitAmount: 280 })).toBe(true)
    expect(affectsPrice(basis, { ...basis, currencyCode: 'USD' })).toBe(true)
    expect(affectsPrice(basis, { ...basis, costModel: 'per_unit' })).toBe(true)
    expect(affectsPrice(basis, { ...basis, role: 'margin_only' })).toBe(true)
    expect(affectsPrice(marginOnly, basis)).toBe(true)
  })
  it('confirming an unchanged value is exempt, other status changes are not', () => {
    expect(affectsPrice(basis, { ...basis, valueStatus: 'confirmed', unitAmount: 300 })).toBe(false)
    expect(affectsPrice(basis, { ...basis, valueStatus: 'confirmed', unitAmount: 280 })).toBe(true)
    expect(affectsPrice({ ...basis, valueStatus: 'confirmed' }, basis)).toBe(true)
    expect(affectsPrice(basis, { ...basis, valueStatus: 'none', unitAmount: null })).toBe(true)
  })
  it('supplier / validity edits alone are exempt', () => {
    expect(affectsPrice(basis, { ...basis, validUntil: '2027-01-01', supplierTermEnd: '2028-01-01' })).toBe(false)
  })
})

describe('extendsValidity', () => {
  it('detects a later date or a longer term only', () => {
    expect(extendsValidity({ ...basis, validUntil: '2026-12-01' }, { ...basis, validUntil: '2027-01-01' })).toBe(true)
    expect(extendsValidity({ ...basis, validUntil: null }, { ...basis, validUntil: '2027-01-01' })).toBe(true)
    expect(extendsValidity({ ...basis, validUntil: '2027-01-01' }, { ...basis, validUntil: '2026-12-01' })).toBe(false)
    expect(extendsValidity({ ...basis, supplierMinTermMonths: 12 }, { ...basis, supplierMinTermMonths: 24 })).toBe(true)
    expect(extendsValidity({ ...basis, supplierTermEnd: '2027-01-01' }, { ...basis, supplierTermEnd: '2028-01-01' })).toBe(true)
    expect(extendsValidity(basis, basis)).toBe(false)
  })
})

describe('isWriteRefused', () => {
  it('locks price-affecting writes only, and everything on a terminal quote', () => {
    expect(isWriteRefused({ locked: false, status: 'ready', priceAffecting: true })).toBe(false)
    expect(isWriteRefused({ locked: true, status: 'with_customer', priceAffecting: true })).toBe(true)
    expect(isWriteRefused({ locked: true, status: 'with_customer', priceAffecting: false })).toBe(false)
    // accepted is locked, but not closed: the R11 exemptions stay open so costs can be confirmed for conversion (R7).
    expect(isWriteRefused({ locked: true, status: 'accepted', priceAffecting: false })).toBe(false)
    expect(isWriteRefused({ locked: true, status: 'accepted', priceAffecting: true })).toBe(true)
    expect(isWriteRefused({ locked: true, status: 'cancelled', priceAffecting: false })).toBe(true)
    expect(isWriteRefused({ locked: true, status: 'rejected', priceAffecting: false })).toBe(true)
  })
})
