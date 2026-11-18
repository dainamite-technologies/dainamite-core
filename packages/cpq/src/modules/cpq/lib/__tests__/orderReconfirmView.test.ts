import { buildReconfirmPatch, canReconfirm, reconfirmErrorCode, reconfirmFormFromCost, reconfirmIssues } from '../orderReconfirmView'

const cost = { unitAmount: '270', currencyCode: 'EUR', supplierName: 'Carrier X', supplierQuoteRef: 'Q-1', validUntil: '2027-01-01', supplierTermEnd: '2028-11-30', supplierMinTermMonths: null }
const form = (over = {}) => ({ ...reconfirmFormFromCost(cost, 'EUR'), ...over })
const ALL = ['cpq.costs.view', 'cpq.costs.manage', 'cpq.orders.manage']

describe('canReconfirm', () => {
  it('needs a draft / pending order and all three features', () => {
    expect(canReconfirm('draft', ALL)).toBe(true)
    expect(canReconfirm('pending_activation', ALL)).toBe(true)
    expect(canReconfirm('active', ALL)).toBe(false)
    expect(canReconfirm('cancelled', ALL)).toBe(false)
    expect(canReconfirm('draft', ['cpq.costs.manage', 'cpq.orders.manage'])).toBe(false)
    expect(canReconfirm('draft', ['cpq.costs.view', 'cpq.orders.manage'])).toBe(false)
  })
})

describe('reconfirmIssues', () => {
  it('flags an untouched form', () => expect(reconfirmIssues(form(), cost)).toEqual(['NO_CHANGE']))
  it('a changed value needs a new quote ref or a note', () => {
    expect(reconfirmIssues(form({ unitAmount: '240' }), cost)).toEqual(['NOTE_REQUIRED'])
    expect(reconfirmIssues(form({ unitAmount: '240', supplierQuoteRef: 'Q-1' }), cost)).toEqual(['NOTE_REQUIRED'])
    expect(reconfirmIssues(form({ unitAmount: '240', supplierQuoteRef: 'Q-2' }), cost)).toEqual([])
    expect(reconfirmIssues(form({ unitAmount: '240', note: 'carrier confirmed' }), cost)).toEqual([])
  })
  it('a currency change is a value change', () => expect(reconfirmIssues(form({ currencyCode: 'USD' }), cost)).toEqual(['NOTE_REQUIRED']))
  it('extending validity needs evidence; shortening does not', () => {
    expect(reconfirmIssues(form({ validUntil: '2028-01-01' }), cost)).toEqual(['VALIDITY_EVIDENCE_REQUIRED'])
    expect(reconfirmIssues(form({ validUntil: '2028-01-01', note: 'ok' }), cost)).toEqual([])
    expect(reconfirmIssues(form({ validUntil: '2026-12-01' }), cost)).toEqual([])
  })
  it('format problems come first', () => {
    expect(reconfirmIssues(form({ unitAmount: 'abc', validUntil: 'x', currencyCode: 'eu', supplierMinTermMonths: '1.5' }), cost))
      .toEqual(['AMOUNT_INVALID', 'CURRENCY_INVALID', 'DATE_INVALID', 'TERM_INVALID'])
  })
})

describe('buildReconfirmPatch', () => {
  it('sends only what changed, plus the note', () => {
    expect(buildReconfirmPatch(form({ unitAmount: '240', note: ' why ' }), cost)).toEqual({ unitAmount: 240, currencyCode: 'EUR', note: 'why' })
    expect(buildReconfirmPatch(form({ supplierName: '' }), cost)).toEqual({ supplierName: null })
    expect(buildReconfirmPatch(form({ note: 'only a note' }), cost)).toEqual({})
  })
  it('a cost with no stored currency: the amount travels with the currency the form holds (default or typed), never dropped', () => {
    const unknown = { ...cost, unitAmount: null, currencyCode: null }
    const blank = (over = {}) => ({ ...reconfirmFormFromCost(unknown, 'EUR'), ...over })
    expect(buildReconfirmPatch(blank({ unitAmount: '250', note: 'n' }), unknown)).toEqual({ unitAmount: 250, currencyCode: 'EUR', note: 'n' })
    expect(buildReconfirmPatch(blank({ unitAmount: '250', currencyCode: 'USD', note: 'n' }), unknown)).toEqual({ unitAmount: 250, currencyCode: 'USD', note: 'n' })
  })
  it('a currency-only change on a stored currency is sent; an untouched currency is not', () => {
    expect(buildReconfirmPatch(form({ currencyCode: 'USD' }), cost)).toEqual({ currencyCode: 'USD' })
    expect(buildReconfirmPatch(form({ supplierName: '' }), cost)).not.toHaveProperty('currencyCode')
  })
})

describe('reconfirmErrorCode', () => {
  it('uses the body code, else the status', () => {
    expect(reconfirmErrorCode(409, { error: 'ORDER_CANCELLED' })).toBe('ORDER_CANCELLED')
    expect(reconfirmErrorCode(422, { error: 'CURRENCY_NO_RATE', from: 'USD' })).toBe('CURRENCY_NO_RATE')
    expect(reconfirmErrorCode(409, {})).toBe('ORDER_ACTIVATED')
    expect(reconfirmErrorCode(403, null)).toBe('FORBIDDEN')
  })
})
