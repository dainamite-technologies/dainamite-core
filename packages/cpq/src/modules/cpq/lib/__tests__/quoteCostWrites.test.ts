import {
  bundleRollupRows,
  buildCostCreateBody,
  buildCostPatch,
  buildMarkupBody,
  costErrorCode,
  costErrorFallback,
  costFormFromCost,
  costFormIssues,
  emptyCostForm,
  formatMoney,
  hasAnyCosts,
  markupClearQuery,
  markupFormIssues,
  marginCardView,
  marginFlags,
  parseAmount,
  statusFailure,
  type FullQuoteCost,
  type MarginFigures,
} from '../quoteCostView'

const figures = (patch: Partial<MarginFigures> = {}): MarginFigures => ({
  nrcCost: 0, mrcCost: 0, nrcOffer: 0, mrcOffer: 0, nrcMargin: 100, mrcMargin: 50, contractCost: 0, contractOffer: 0, contractMargin: 700,
  marginPercent: 41.2, markupPercent: null, costCoverage: 80, hasPendingCosts: false, hasEstimatedCosts: false, hasExpiredCosts: false, ...patch,
})
const catalogCost: FullQuoteCost = {
  id: 'c1', costKey: 'transport', name: 'Transport', role: 'price_basis', valueStatus: 'confirmed', expired: false,
  quoteLineId: 'l1', chargeCode: 'fee', origin: 'catalog', valueOrigin: 'catalog', costType: 'mrc', source: 'fixed', costModel: 'flat',
  unitAmount: '100.0000', instanceAmount: '100.0000', currencyCode: 'EUR', supplierName: 'Acme', supplierQuoteRef: 'Q-1',
  validUntil: '2026-12-31', supplierTermEnd: null, supplierMinTermMonths: null, note: null,
}
const manualCost: FullQuoteCost = { ...catalogCost, id: 'c2', origin: 'manual', valueOrigin: 'manual', costKey: 'manual:x' }

describe('margin view', () => {
  it('formats money and renders null percentages as a dash', () => {
    expect(formatMoney(1234.5, 'EUR')).toContain('1,234.50')
    expect(formatMoney(null, 'EUR')).toBe('—')
    const view = marginCardView(figures({ marginPercent: null, costCoverage: 0 }), 'EUR')
    expect(view.marginPercent).toBe('—')
    expect(view.coverage).toBe('0%')
    expect(marginCardView(figures(), 'EUR').marginPercent).toBe('41.2%')
  })

  it('lists the flags in a stable order', () => {
    expect(marginFlags(figures({ hasExpiredCosts: true, hasPendingCosts: true }))).toEqual(['pending', 'expired'])
    expect(marginFlags(figures())).toEqual([])
  })

  it('builds roll-up rows for bundle parents only, skipping unknown lines', () => {
    const margin = { lines: [{ lineId: 'b', own: figures(), rollup: figures({ contractMargin: 900, marginPercent: 30 }), charges: [] }] }
    const rows = bundleRollupRows(margin, [{ lineId: 'b', name: 'Bundle' }, { lineId: 'gone', name: 'Gone' }], 'EUR')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Bundle', marginPercent: '30%' })
    expect(rows[0].contractMargin).toContain('900')
  })

  it('detects whether any line carries costs', () => {
    expect(hasAnyCosts([{ costs: [] }])).toBe(false)
    expect(hasAnyCosts(undefined)).toBe(false)
    expect(hasAnyCosts([{ costs: [] }, { costs: [{}] }])).toBe(true)
  })
})

describe('write error codes', () => {
  it('reads the SCREAMING_CASE error, else maps the status', () => {
    expect(costErrorCode(409, { error: 'STALE_REVISION' })).toBe('STALE_REVISION')
    expect(costErrorCode(422, { error: 'NOTE_REQUIRED' })).toBe('NOTE_REQUIRED')
    expect(costErrorCode(409, {})).toBe('COST_LOCKED')
    expect(costErrorCode(403, null)).toBe('FORBIDDEN')
    expect(costErrorCode(400, { error: 'Validation error' })).toBe('VALIDATION')
    expect(costErrorCode(500, undefined)).toBe('UNKNOWN')
  })

  it('has a message for every documented code', () => {
    for (const code of ['COST_LOCKED', 'STALE_REVISION', 'NOTE_REQUIRED', 'VALIDITY_EVIDENCE_REQUIRED', 'PRICE_BASIS_REQUIRES_COST_PLUS', 'CHARGE_NOT_COST_PLUS', 'CATALOG_COST_NOT_DELETABLE']) {
      expect(costErrorFallback(code)).not.toBe(code)
    }
    expect(costErrorFallback('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('treats a stale status change as its own case, other failures as their message', () => {
    expect(statusFailure(409, { error: 'STALE_REVISION' })).toEqual({ kind: 'stale' })
    expect(statusFailure(409, { error: 'Transition not allowed' })).toEqual({ kind: 'error', message: 'Transition not allowed' })
    expect(statusFailure(500, null)).toEqual({ kind: 'error', message: 'Request failed (500)' })
  })
})

describe('cost form', () => {
  it('parses amounts strictly', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(' 12.5 ')).toBe(12.5)
    expect(parseAmount('-1')).toBeNaN()
    expect(parseAmount('1.23456')).toBeNaN()
    expect(parseAmount('abc')).toBeNaN()
  })

  it('creates with expectedRevision and omits empty fields', () => {
    const form = { ...emptyCostForm('EUR'), name: ' Install ', costType: 'nrc' as const, unitAmount: '40', chargeCode: 'fee', note: 'quote 7' }
    expect(buildCostCreateBody(form, 'l1', 7)).toEqual({
      quoteLineId: 'l1', chargeCode: 'fee', name: 'Install', role: 'margin_only', costType: 'nrc', source: 'fixed', costModel: 'flat',
      unitAmount: 40, valueStatus: 'estimated', currencyCode: 'EUR', note: 'quote 7', expectedRevision: 7,
    })
    const onRequest = buildCostCreateBody({ ...emptyCostForm('EUR'), name: 'X', source: 'on_request', unitAmount: '9' }, 'l1', 0)
    expect(onRequest).toMatchObject({ unitAmount: 9, valueStatus: 'estimated' })
    expect(buildCostCreateBody({ ...emptyCostForm('EUR'), name: 'X', source: 'on_request' }, 'l1', 0)).not.toHaveProperty('unitAmount')
    expect(onRequest.chargeCode).toBeNull()
    expect(onRequest.expectedRevision).toBe(0)
  })

  it('requires a name and a valid amount on add', () => {
    expect(costFormIssues(emptyCostForm('EUR'), null)).toContain('NAME_REQUIRED')
    expect(costFormIssues({ ...emptyCostForm('EUR'), name: 'x', unitAmount: '1.00001' }, null)).toContain('AMOUNT_INVALID')
    expect(costFormIssues({ ...emptyCostForm('EUR'), name: 'x', unitAmount: '5' }, null)).toEqual([])
  })

  it('requires a note when overwriting a catalog value, but not for manual or unchanged values', () => {
    const form = costFormFromCost(catalogCost, 'EUR', false)
    expect(costFormIssues(form, catalogCost)).toEqual([])
    expect(costFormIssues({ ...form, unitAmount: '120' }, catalogCost)).toEqual(['NOTE_REQUIRED'])
    expect(costFormIssues({ ...form, unitAmount: '120', note: 'renegotiated' }, catalogCost)).toEqual([])
    expect(costFormIssues({ ...form, unitAmount: '120' }, manualCost)).toEqual([])
  })

  it('requires evidence to extend validity: a new supplier quote ref or a note', () => {
    const form = { ...costFormFromCost(manualCost, 'EUR', false), validUntil: '2027-03-01' }
    expect(costFormIssues(form, manualCost)).toEqual(['VALIDITY_EVIDENCE_REQUIRED'])
    expect(costFormIssues({ ...form, supplierQuoteRef: 'Q-1' }, manualCost)).toEqual(['VALIDITY_EVIDENCE_REQUIRED'])
    expect(costFormIssues({ ...form, supplierQuoteRef: 'Q-2' }, manualCost)).toEqual([])
    expect(costFormIssues({ ...form, note: 'supplier confirmed by phone' }, manualCost)).toEqual([])
    expect(costFormIssues({ ...form, validUntil: '2026-06-01' }, manualCost)).toEqual([])
  })

  it('patches only what changed and always carries expectedRevision', () => {
    const form = { ...costFormFromCost(catalogCost, 'EUR', false), unitAmount: '120', note: 'new price' }
    expect(buildCostPatch(form, catalogCost, false, 9)).toEqual({ unitAmount: 120, note: 'new price', expectedRevision: 9 })
    const confirm = costFormFromCost(catalogCost, 'EUR', true)
    expect(buildCostPatch(confirm, catalogCost, true, 3)).toEqual({ valueStatus: 'confirmed', expectedRevision: 3 })
  })

  it('lets a manual cost change its structure, not a catalog cost', () => {
    const rename = { ...costFormFromCost(manualCost, 'EUR', false), name: 'Renamed', role: 'margin_only' as const }
    expect(buildCostPatch(rename, manualCost, false, 1)).toMatchObject({ name: 'Renamed', role: 'margin_only' })
    const same = { ...costFormFromCost(catalogCost, 'EUR', false), name: 'Renamed' }
    expect(buildCostPatch(same, catalogCost, false, 1)).not.toHaveProperty('name')
  })
})

describe('on_request catalog cost (estimated tail)', () => {
  const tail: FullQuoteCost = {
    ...catalogCost, id: 'c3', costKey: 'tail', name: 'Tail', source: 'on_request', valueStatus: 'estimated', valueOrigin: 'catalog',
    unitAmount: '300.0000', instanceAmount: '300.0000', currencyCode: 'EUR', supplierQuoteRef: null, validUntil: null, supplierName: null,
  }
  const unpriced: FullQuoteCost = { ...tail, id: 'c4', valueStatus: 'none', valueOrigin: null, unitAmount: null, instanceAmount: null, currencyCode: null }

  it('confirming an unchanged estimate sends only the status and the revision, with no note needed', () => {
    const form = costFormFromCost(tail, 'EUR', true)
    expect(form.unitAmount).toBe('300.0000')
    expect(costFormIssues(form, tail)).toEqual([])
    expect(buildCostPatch(form, tail, true, 5)).toEqual({ valueStatus: 'confirmed', expectedRevision: 5 })
  })

  it('a supplier-ref-only edit never sends or clears the value', () => {
    const form = { ...costFormFromCost(tail, 'EUR', false), supplierQuoteRef: 'Q-9' }
    const patch = buildCostPatch(form, tail, false, 5)
    expect(patch).toEqual({ supplierQuoteRef: 'Q-9', expectedRevision: 5 })
    expect(patch).not.toHaveProperty('unitAmount')
    expect(patch).not.toHaveProperty('currencyCode')
  })

  it('entering 280 EUR confirmed with a supplier ref overwrites the catalog value and needs a note', () => {
    const form = { ...costFormFromCost(tail, 'EUR', false), unitAmount: '280', valueStatus: 'confirmed' as const, supplierQuoteRef: 'SQ-1' }
    expect(costFormIssues(form, tail)).toEqual(['NOTE_REQUIRED'])
    const withNote = { ...form, note: 'supplier quoted 280' }
    expect(costFormIssues(withNote, tail)).toEqual([])
    expect(buildCostPatch(withNote, tail, false, 6)).toEqual({
      unitAmount: 280, valueStatus: 'confirmed', supplierQuoteRef: 'SQ-1', note: 'supplier quoted 280', expectedRevision: 6,
    })
  })

  it('a cost with no value yet takes a value without a note and carries the currency', () => {
    const base = costFormFromCost(unpriced, 'EUR', false)
    expect(buildCostPatch(base, unpriced, false, 1)).toEqual({ expectedRevision: 1 })
    expect(costFormIssues(base, unpriced)).toEqual([])
    const entered = { ...base, unitAmount: '280', valueStatus: 'confirmed' as const, supplierQuoteRef: 'SQ-1' }
    expect(costFormIssues(entered, unpriced)).toEqual([])
    expect(buildCostPatch(entered, unpriced, false, 2)).toEqual({ unitAmount: 280, currencyCode: 'EUR', valueStatus: 'confirmed', supplierQuoteRef: 'SQ-1', expectedRevision: 2 })
  })
})

describe('markup override form', () => {
  const form = { chargeCode: 'fee', markupRule: 'markup_percent' as const, markupValue: '25', note: 'strategic deal' }

  it('requires a charge, a value and a note of at most 500 characters', () => {
    expect(markupFormIssues(form)).toEqual([])
    expect(markupFormIssues({ ...form, chargeCode: '' })).toEqual(['CHARGE_REQUIRED'])
    expect(markupFormIssues({ ...form, markupValue: '' })).toEqual(['VALUE_INVALID'])
    expect(markupFormIssues({ ...form, note: '  ' })).toEqual(['NOTE_REQUIRED'])
    expect(markupFormIssues({ ...form, note: 'x'.repeat(501) })).toEqual(['NOTE_TOO_LONG'])
    expect(markupFormIssues({ ...form, markupRule: 'target_margin_percent', markupValue: '100' })).toEqual(['TARGET_MARGIN_TOO_HIGH'])
  })

  it('sends expectedRevision in the body and in the clear query', () => {
    expect(buildMarkupBody(form, 'l1', 4)).toEqual({ quoteLineId: 'l1', chargeCode: 'fee', markupRule: 'markup_percent', markupValue: 25, note: 'strategic deal', expectedRevision: 4 })
    expect(markupClearQuery('l1', 'fee code', 4)).toBe('quoteLineId=l1&chargeCode=fee%20code&expectedRevision=4')
  })
})
