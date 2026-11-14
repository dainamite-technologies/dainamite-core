import { lookupTablePrice, type LookupEntry, type LookupTable } from '../costLookup'

const entry = (over: Partial<LookupEntry>): LookupEntry => ({
  dimensionValues: {}, tierNumber: null, rangeFrom: null, rangeTo: null, prices: {}, currencyCode: 'USD', ...over,
})

const dimTable: LookupTable = {
  dimensions: [{ key: 'region' }, { key: 'size' }],
  entries: [
    entry({ dimensionValues: { region: 'eu', size: 'sm' }, prices: { mrc: 10, nrc: 100 } }),
    entry({ dimensionValues: { region: 'eu', size: 'sm' }, prices: { mrc: 9, nrc: 90 }, currencyCode: 'EUR' }),
    entry({ dimensionValues: { region: 'us', size: 'lg' }, prices: { mrc: 30 } }),
  ],
}

const tierTable: LookupTable = {
  dimensions: [],
  entries: [
    entry({ tierNumber: 2, rangeFrom: '101', rangeTo: null, prices: { rate: 0.4 } }),
    entry({ tierNumber: 0, rangeFrom: '0', rangeTo: '50', prices: { rate: 1 } }),
    entry({ tierNumber: 1, rangeFrom: '51', rangeTo: '100', prices: { rate: 0.5 } }),
  ],
}

describe('lookupTablePrice — flat', () => {
  it('prices quantity 1 at the matched entry and ignores the passed quantity', () => {
    expect(lookupTablePrice(dimTable, 'mrc', 'flat', { region: 'eu', size: 'sm' }, 7)).toEqual({
      outcome: 'priced', unitPrice: 10, quantity: 1, totalPrice: 10, currencyCode: 'USD',
    })
  })
  it('matches dimensions case-insensitively and by string coercion', () => {
    expect(lookupTablePrice(dimTable, 'nrc', 'flat', { region: 'EU', size: 'SM' }, 1)).toMatchObject({ unitPrice: 100 })
    const numeric: LookupTable = { dimensions: [{ key: 'ha' }], entries: [entry({ dimensionValues: { ha: '1' }, prices: { mrc: 5 } })] }
    expect(lookupTablePrice(numeric, 'mrc', 'flat', { ha: 1 }, 1)).toMatchObject({ unitPrice: 5 })
  })
  it('misses on an unmatched dimension, treating a missing config value as empty (no wildcard support)', () => {
    expect(lookupTablePrice(dimTable, 'mrc', 'flat', { region: 'apac', size: 'sm' }, 1)).toEqual({ outcome: 'miss' })
    expect(lookupTablePrice(dimTable, 'mrc', 'flat', { region: 'eu' }, 1)).toEqual({ outcome: 'miss' })
  })
  it('takes the first matching entry and prices an unknown column at 0', () => {
    expect(lookupTablePrice(dimTable, 'nope', 'flat', { region: 'us', size: 'lg' }, 1)).toMatchObject({ unitPrice: 0, totalPrice: 0 })
  })
  it('matches any config for a table without dimensions', () => {
    expect(lookupTablePrice({ dimensions: [], entries: [entry({ prices: { a: 3 } })] }, 'a', 'flat', { whatever: 1 }, 1)).toMatchObject({ unitPrice: 3 })
  })
  it('misses on an empty table', () => {
    expect(lookupTablePrice({ dimensions: [], entries: [] }, 'a', 'flat', {}, 1)).toEqual({ outcome: 'miss' })
  })
})

describe('lookupTablePrice — currency column selection', () => {
  it('selects only entries in the requested currency', () => {
    expect(lookupTablePrice(dimTable, 'mrc', 'flat', { region: 'eu', size: 'sm' }, 1, 'EUR')).toMatchObject({ unitPrice: 9, currencyCode: 'EUR' })
  })
  it('misses when no entry exists in the requested currency', () => {
    expect(lookupTablePrice(dimTable, 'mrc', 'flat', { region: 'us', size: 'lg' }, 1, 'EUR')).toEqual({ outcome: 'miss' })
  })
  it('does not filter by currency when none is given', () => {
    expect(lookupTablePrice(dimTable, 'mrc', 'flat', { region: 'eu', size: 'sm' }, 1, null)).toMatchObject({ unitPrice: 10, currencyCode: 'USD' })
  })
})

describe('lookupTablePrice — per_unit', () => {
  it('multiplies the unit price by the quantity', () => {
    expect(lookupTablePrice(dimTable, 'mrc', 'per_unit', { region: 'us', size: 'lg' }, 4)).toEqual({
      outcome: 'priced', unitPrice: 30, quantity: 4, totalPrice: 120, currencyCode: 'USD',
    })
  })
  it('keeps a zero quantity (no zero_quantity short-circuit) and misses like flat', () => {
    expect(lookupTablePrice(dimTable, 'mrc', 'per_unit', { region: 'us', size: 'lg' }, 0)).toMatchObject({ outcome: 'priced', quantity: 0, totalPrice: 0 })
    expect(lookupTablePrice(dimTable, 'mrc', 'per_unit', { region: 'x', size: 'y' }, 3)).toEqual({ outcome: 'miss' })
  })
})

describe('lookupTablePrice — tiered', () => {
  it('bills each slice at its own tier rate, sorted by tier number', () => {
    const result = lookupTablePrice(tierTable, 'rate', 'tiered', {}, 120)
    expect(result).toEqual({
      outcome: 'priced', unitPrice: (50 * 1 + 50 * 0.5 + 20 * 0.4) / 120, quantity: 120, totalPrice: 83, currencyCode: 'USD',
      tiers: [
        { tier: 0, from: 1, to: 50, pricePerUnit: 1, quantity: 50, subtotal: 50 },
        { tier: 1, from: 51, to: 100, pricePerUnit: 0.5, quantity: 50, subtotal: 25 },
        { tier: 2, from: 101, to: 120, pricePerUnit: 0.4, quantity: 20, subtotal: 8 },
      ],
    })
  })
  it('stops allocating once the quantity is covered', () => {
    const result = lookupTablePrice(tierTable, 'rate', 'tiered', {}, 30)
    expect(result).toMatchObject({ outcome: 'priced', totalPrice: 30, unitPrice: 1 })
    expect((result as { tiers: unknown[] }).tiers).toHaveLength(1)
  })
  it('returns zero_quantity for quantity <= 0 before reading the table', () => {
    expect(lookupTablePrice(tierTable, 'rate', 'tiered', {}, 0)).toEqual({ outcome: 'zero_quantity' })
    expect(lookupTablePrice({ dimensions: [{ key: 'r' }], entries: [] }, 'rate', 'tiered', {}, -1)).toEqual({ outcome: 'zero_quantity' })
  })
  it('filters to the dimension-matched slice and misses when nothing matches', () => {
    const table: LookupTable = {
      dimensions: [{ key: 'region' }],
      entries: [
        entry({ dimensionValues: { region: 'eu' }, tierNumber: 0, rangeTo: '10', prices: { r: 5 } }),
        entry({ dimensionValues: { region: 'eu' }, tierNumber: 1, rangeTo: null, prices: { r: 3 } }),
        entry({ dimensionValues: { region: 'us' }, tierNumber: 0, rangeTo: null, prices: { r: 9 } }),
      ],
    }
    expect(lookupTablePrice(table, 'r', 'tiered', { region: 'EU' }, 15)).toMatchObject({ totalPrice: 5 * 10 + 3 * 5 })
    expect(lookupTablePrice(table, 'r', 'tiered', { region: 'us' }, 15)).toMatchObject({ totalPrice: 135 })
    expect(lookupTablePrice(table, 'r', 'tiered', { region: 'apac' }, 15)).toEqual({ outcome: 'miss' })
  })
  it('selects the currency column per tier', () => {
    const table: LookupTable = {
      dimensions: [],
      entries: [
        entry({ tierNumber: 0, rangeTo: null, prices: { r: 2 } }),
        entry({ tierNumber: 0, rangeTo: null, prices: { r: 1.8 }, currencyCode: 'EUR' }),
      ],
    }
    expect(lookupTablePrice(table, 'r', 'tiered', {}, 10, 'EUR')).toMatchObject({ totalPrice: 18, currencyCode: 'EUR' })
  })
})

describe('lookupTablePrice — volume', () => {
  it('bills the whole quantity at the rate of the containing tier', () => {
    expect(lookupTablePrice(tierTable, 'rate', 'volume', {}, 75)).toEqual({
      outcome: 'priced', unitPrice: 0.5, quantity: 75, totalPrice: 37.5, currencyCode: 'USD',
    })
    expect(lookupTablePrice(tierTable, 'rate', 'volume', {}, 500)).toMatchObject({ unitPrice: 0.4, totalPrice: 200 })
  })
  it('treats range bounds as inclusive and a null rangeFrom as 0', () => {
    expect(lookupTablePrice(tierTable, 'rate', 'volume', {}, 50)).toMatchObject({ unitPrice: 1 })
    expect(lookupTablePrice(tierTable, 'rate', 'volume', {}, 51)).toMatchObject({ unitPrice: 0.5 })
    const open: LookupTable = { dimensions: [], entries: [entry({ tierNumber: 0, rangeFrom: null, rangeTo: '10', prices: { r: 2 } })] }
    expect(lookupTablePrice(open, 'r', 'volume', {}, 3)).toMatchObject({ unitPrice: 2 })
  })
  it('falls back to the top tier when the quantity overflows every range, and into a gap', () => {
    const capped: LookupTable = {
      dimensions: [],
      entries: [
        entry({ tierNumber: 0, rangeFrom: '1', rangeTo: '10', prices: { r: 2 } }),
        entry({ tierNumber: 1, rangeFrom: '11', rangeTo: '20', prices: { r: 1 } }),
      ],
    }
    expect(lookupTablePrice(capped, 'r', 'volume', {}, 99)).toMatchObject({ unitPrice: 1, totalPrice: 99 })
  })
  it('returns zero_quantity, misses on dimensions, and honours dimensions and currency', () => {
    expect(lookupTablePrice(tierTable, 'rate', 'volume', {}, 0)).toEqual({ outcome: 'zero_quantity' })
    const table: LookupTable = {
      dimensions: [{ key: 'region' }],
      entries: [
        entry({ dimensionValues: { region: 'eu' }, tierNumber: 0, rangeTo: null, prices: { r: 4 } }),
        entry({ dimensionValues: { region: 'eu' }, tierNumber: 0, rangeTo: null, prices: { r: 3 }, currencyCode: 'GBP' }),
      ],
    }
    expect(lookupTablePrice(table, 'r', 'volume', { region: 'us' }, 5)).toEqual({ outcome: 'miss' })
    expect(lookupTablePrice(table, 'r', 'volume', { region: 'eu' }, 5, 'GBP')).toMatchObject({ unitPrice: 3, currencyCode: 'GBP' })
  })
})

describe('lookupTablePrice — requireColumn (cost lookups, R5)', () => {
  const strict = { requireColumn: true }
  it('a matched flat / per_unit entry without the column is a miss; price lookups keep pricing it at 0', () => {
    expect(lookupTablePrice(dimTable, 'nrc', 'flat', { region: 'us', size: 'lg' }, 1, 'USD', strict)).toEqual({ outcome: 'miss' })
    expect(lookupTablePrice(dimTable, 'nrc', 'per_unit', { region: 'us', size: 'lg' }, 3, 'USD', strict)).toEqual({ outcome: 'miss' })
    expect(lookupTablePrice(dimTable, 'nrc', 'flat', { region: 'us', size: 'lg' }, 1, 'USD')).toMatchObject({ outcome: 'priced', unitPrice: 0 })
    expect(lookupTablePrice(dimTable, 'nrc', 'flat', { region: 'eu', size: 'sm' }, 1, 'USD', strict)).toMatchObject({ outcome: 'priced', unitPrice: 100 })
  })
  it('volume: the chosen tier without the column is a miss', () => {
    const table: LookupTable = { dimensions: [], entries: [
      entry({ tierNumber: 0, rangeFrom: '0', rangeTo: '10', prices: { r: 5 } }),
      entry({ tierNumber: 1, rangeFrom: '11', rangeTo: null, prices: {} }),
    ] }
    expect(lookupTablePrice(table, 'r', 'volume', {}, 20, 'USD', strict)).toEqual({ outcome: 'miss' })
    expect(lookupTablePrice(table, 'r', 'volume', {}, 5, 'USD', strict)).toMatchObject({ outcome: 'priced', totalPrice: 25 })
  })
  it('tiered: a consumed tier without the column is a miss; an unconsumed one does not matter', () => {
    const table: LookupTable = { dimensions: [], entries: [
      entry({ tierNumber: 0, rangeTo: '10', prices: { r: 5 } }),
      entry({ tierNumber: 1, rangeTo: null, prices: { other: 1 } }),
    ] }
    expect(lookupTablePrice(table, 'r', 'tiered', {}, 15, 'USD', strict)).toEqual({ outcome: 'miss' })
    expect(lookupTablePrice(table, 'r', 'tiered', {}, 8, 'USD', strict)).toMatchObject({ outcome: 'priced', totalPrice: 40 })
    expect(lookupTablePrice(table, 'r', 'tiered', {}, 0, 'USD', strict)).toEqual({ outcome: 'zero_quantity' })
  })
})
