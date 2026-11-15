import { formatIban, isValidBic, isValidIban, normalizeIban } from '../../lib/iban'

describe('IBAN', () => {
  it('normalizes spaces and case', () => {
    expect(normalizeIban(' pl61 1090 1014 0000 0712 1981 2874 ')).toBe('PL61109010140000071219812874')
  })

  it('accepts valid IBANs (mod-97)', () => {
    expect(isValidIban('PL61 1090 1014 0000 0712 1981 2874')).toBe(true)
    expect(isValidIban('DE89370400440532013000')).toBe(true)
    expect(isValidIban('GB29NWBK60161331926819')).toBe(true)
  })

  it('rejects typos and malformed values', () => {
    expect(isValidIban('PL61109010140000071219812875')).toBe(false)
    expect(isValidIban('DE89370400440532013001')).toBe(false)
    expect(isValidIban('PL6110901014')).toBe(false)
    expect(isValidIban('1234567890123456')).toBe(false)
    expect(isValidIban('')).toBe(false)
  })

  it('formats in groups of four', () => {
    expect(formatIban('PL61109010140000071219812874')).toBe('PL61 1090 1014 0000 0712 1981 2874')
  })
})

describe('BIC', () => {
  it('accepts 8 and 11 character codes', () => {
    expect(isValidBic('WBKPPLPP')).toBe(true)
    expect(isValidBic('deutdeffxxx')).toBe(true)
  })

  it('rejects other lengths and shapes', () => {
    expect(isValidBic('WBKPPL')).toBe(false)
    expect(isValidBic('WBKPPLPPX')).toBe(false)
    expect(isValidBic('1BKPPLPP')).toBe(false)
  })
})
