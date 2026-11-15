import {
  costErrorText, formatAmount, formatConverted, formatRate, fxHintMessage, fxTooltip, isHintableCurrency, missingRateMessage, pendingIsRateOnly, snapshotNote,
  type Translate,
} from '../fxView'

// Fallback-only translator with {param} interpolation, like useT without a dictionary.
const t: Translate = (_key, fallback = '', params) => fallback.replace(/\{(\w+)\}/g, (_m, name) => String(params?.[name] ?? ''))

const converted = { fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'direct', convertedInstanceAmount: '276', quoteCurrencyCode: 'EUR' }

describe('formatters', () => {
  it('trims the rate and pads the amount', () => {
    expect(formatRate('0.92000000')).toBe('0.92')
    expect(formatRate('1.00000000')).toBe('1')
    expect(formatRate('10.50000000')).toBe('10.5')
    expect(formatRate(null)).toBeNull()
    expect(formatAmount('276')).toBe('276.00')
    expect(formatAmount('1234.5')).toBe('1,234.50')
    expect(formatAmount('x')).toBeNull()
  })
})

describe('formatConverted', () => {
  it('renders "≈ 276.00 EUR · 0.92 · ECB · 2026-11-11"', () => {
    expect(formatConverted(converted, null, t)?.text).toBe('≈ 276.00 EUR · 0.92 · ECB · 2026-11-11')
  })
  it('labels an inverse-derived rate and prefers the caller currency', () => {
    expect(formatConverted({ ...converted, fxRateDerivation: 'inverse', quoteCurrencyCode: undefined }, 'PLN', t)?.text).toBe('≈ 276.00 PLN · 0.92 (inverse) · ECB · 2026-11-11')
  })
  it('is null without a rate, and omits the amount when it is unknown', () => {
    expect(formatConverted({ fxRate: null }, 'EUR', t)).toBeNull()
    expect(formatConverted({}, 'EUR', t)).toBeNull()
    expect(formatConverted({ ...converted, convertedInstanceAmount: null }, 'EUR', t)?.text).toBe('0.92 · ECB · 2026-11-11')
  })
})

describe('fxTooltip', () => {
  it('names date, source and derivation; adds the frozen note only while locked', () => {
    expect(fxTooltip(converted, {}, t)).toBe('Rate of 2026-11-11 from ECB (direct rate)')
    expect(fxTooltip(converted, { locked: true }, t)).toBe('Rate frozen while the quote is locked. Rate of 2026-11-11 from ECB (direct rate)')
    expect(fxTooltip({ ...converted, fxRateDerivation: 'inverse' }, {}, t)).toContain('inverse of the opposite pair')
    expect(fxTooltip({}, { locked: true }, t)).toBeNull()
  })
})

describe('missing rate', () => {
  const detail = { code: 'CURRENCY_NO_RATE', from: 'USD', to: 'EUR', date: '2026-11-12' }
  it('names the pair and date, and the look-back when known', () => {
    expect(missingRateMessage(detail, t)).toBe('No USD→EUR rate for 2026-11-12')
    expect(missingRateMessage(detail, t, 7)).toBe('No USD→EUR rate for 2026-11-12 (looked back 7 days)')
  })
  it('costErrorText uses the pair message with errorDetail, the plain code text without', () => {
    const fallback = (code: string) => `plain ${code}`
    expect(costErrorText({ error: 'CURRENCY_NO_RATE', errorDetail: detail }, t, fallback)).toBe('No USD→EUR rate for 2026-11-12')
    expect(costErrorText({ error: 'CURRENCY_NO_RATE' }, t, fallback)).toBe('plain CURRENCY_NO_RATE')
    expect(costErrorText({}, t, fallback)).toBeNull()
  })
  it('the redacted badge replaces "Cost pending" only when every pending line lacks a rate', () => {
    expect(pendingIsRateOnly([{ valueStatus: 'none', error: 'CURRENCY_NO_RATE' }])).toBe(true)
    expect(pendingIsRateOnly([{ valueStatus: 'none', error: 'CURRENCY_NO_RATE' }, { valueStatus: 'none' }])).toBe(false)
    expect(pendingIsRateOnly([{ valueStatus: 'confirmed' }])).toBe(false)
  })
})

describe('dialog hint', () => {
  it('shows the rate, the inverse label and the no-rate text', () => {
    const hint = { from: 'USD', to: 'EUR', fxRate: '0.92000000', fxRateDate: '2026-11-11', fxRateSource: 'ECB', fxRateDerivation: 'direct' }
    expect(fxHintMessage(hint, t)).toBe('Converted at the latest rate on save (currently 0.92 from ECB, 2026-11-11)')
    expect(fxHintMessage({ ...hint, fxRateDerivation: 'inverse' }, t)).toContain('0.92 (inverse) from ECB')
    expect(fxHintMessage({ from: 'USD', to: 'EUR', error: 'CURRENCY_NO_RATE' }, t))
      .toBe('No USD→EUR rate maintained — the line will stay not ready until a rate is entered in Currencies')
    expect(fxHintMessage(null, t)).toBeNull()
  })
  it('only asks for a three-letter currency that differs from the quote currency', () => {
    expect(isHintableCurrency('USD', 'EUR')).toBe(true)
    expect(isHintableCurrency('EUR', 'EUR')).toBe(false)
    expect(isHintableCurrency('US', 'EUR')).toBe(false)
  })
})

describe('snapshotNote (order / subscription / asset)', () => {
  it('names the cost-currency origin and the rate, never "frozen"', () => {
    const note = snapshotNote({ ...converted, instanceAmount: '300', currencyCode: 'USD' }, t)
    expect(note).toBe('from 300.00 USD · 0.92 · ECB · 2026-11-11')
    expect(snapshotNote({ instanceAmount: '300', currencyCode: 'EUR' }, t)).toBeNull()
  })
})
