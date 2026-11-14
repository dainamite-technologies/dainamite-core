import {
  ARC_PRICE_FROZEN_KEY,
  arcPricingInputsChanged,
  buildArcMirrorConfiguration,
  ARC_REPRICED_KEY,
  ARC_COST_PLUS_FROZEN_KEY,
  ARC_RECONFIGURED_KEY,
  isArcPriceFrozen,
  isFrozenMirrorLine,
  stripArcMarkers,
  stripQuoteOnlyArcMarkers,
} from '../arcPriceFreeze'

const ITEM = { id: 'item-1', name: 'GIX Access Port' }

describe('buildArcMirrorConfiguration', () => {
  it('freezes Amend mirror lines and keeps the item configuration', () => {
    const cfg = buildArcMirrorConfiguration({ port_size: '1G' }, ITEM, 'amend')
    expect(cfg).toEqual({
      port_size: '1G',
      _arcMirroredFromItemId: 'item-1',
      _arcMirroredName: 'GIX Access Port',
      [ARC_PRICE_FROZEN_KEY]: true,
    })
    expect(isArcPriceFrozen(cfg)).toBe(true)
  })

  it.each(['renew', 'cancel'] as const)('does not freeze %s mirror lines', (quoteType) => {
    const cfg = buildArcMirrorConfiguration({ port_size: '1G' }, ITEM, quoteType)
    expect(isArcPriceFrozen(cfg)).toBe(false)
    expect(cfg._arcMirroredFromItemId).toBe('item-1')
  })

  it('never inherits stale ARC markers from the item configuration', () => {
    const stale = { port_size: '1G', _arcPriceFrozen: true, _arcMirroredFromItemId: 'old-item', _arcMirroredName: 'Old' }
    const renew = buildArcMirrorConfiguration(stale, ITEM, 'renew')
    expect(isArcPriceFrozen(renew)).toBe(false)
    expect(renew).toEqual({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' })
  })

  it('handles an item without configuration', () => {
    expect(buildArcMirrorConfiguration(null, ITEM, 'amend')).toMatchObject({ _arcMirroredName: 'GIX Access Port' })
  })
})

describe('isArcPriceFrozen', () => {
  it('is false for missing or non-boolean markers', () => {
    expect(isArcPriceFrozen(null)).toBe(false)
    expect(isArcPriceFrozen({})).toBe(false)
    expect(isArcPriceFrozen({ [ARC_PRICE_FROZEN_KEY]: 'true' })).toBe(false)
  })
})

describe('arcPricingInputsChanged', () => {
  const before = {
    configuration: { port_size: '1G', data_centre: 'ld5', _arcMirroredFromItemId: 'item-1', [ARC_PRICE_FROZEN_KEY]: true },
    quantity: 2,
    termMonths: 12,
    startDate: new Date('2027-01-01T00:00:00.000Z'),
    endDate: null,
    usageEstimates: [{ chargeCode: 'overage', estimatedQuantity: 10 }],
  }

  it('is false for an unchanged resubmission (markers stripped, key order differs, fields omitted)', () => {
    expect(arcPricingInputsChanged(before, { configuration: { data_centre: 'ld5', port_size: '1G' } })).toBe(false)
  })

  it('is false when unchanged values are resubmitted explicitly', () => {
    expect(
      arcPricingInputsChanged(before, {
        configuration: { port_size: '1G', data_centre: 'ld5' },
        quantity: 2,
        termMonths: 12,
        startDate: '2027-01-01',
        usageEstimates: [{ chargeCode: 'overage', estimatedQuantity: 10 }],
      }),
    ).toBe(false)
  })

  it('detects a configuration change', () => {
    expect(arcPricingInputsChanged(before, { configuration: { port_size: '10G', data_centre: 'ld5' } })).toBe(true)
  })

  it('detects an added configuration key', () => {
    expect(
      arcPricingInputsChanged(before, { configuration: { port_size: '1G', data_centre: 'ld5', cloud_provider: 'aws' } }),
    ).toBe(true)
  })

  it.each([
    ['quantity', { quantity: 3 }],
    ['termMonths', { termMonths: 24 }],
    ['startDate', { startDate: '2027-02-01' }],
    ['endDate', { endDate: '2028-01-01' }],
    ['usageEstimates', { usageEstimates: [{ chargeCode: 'overage', estimatedQuantity: 20 }] }],
  ])('detects a %s change', (_field, change) => {
    expect(arcPricingInputsChanged(before, { configuration: { port_size: '1G', data_centre: 'ld5' }, ...change })).toBe(true)
  })
})

describe('isFrozenMirrorLine', () => {
  const mirrored = { port_size: '1G', _arcMirroredFromItemId: 'item-1', [ARC_PRICE_FROZEN_KEY]: true }

  it('is true only for a flagged mirror line on an Amend quote', () => {
    expect(isFrozenMirrorLine(mirrored, 'amend')).toBe(true)
  })

  it.each(['new', 'renew', 'cancel', null, undefined])('ignores the flag on a %s quote', (quoteType) => {
    expect(isFrozenMirrorLine(mirrored, quoteType)).toBe(false)
  })

  it('ignores the flag on a line that is not a mirror line', () => {
    expect(isFrozenMirrorLine({ port_size: '1G', [ARC_PRICE_FROZEN_KEY]: true }, 'amend')).toBe(false)
  })
})

describe('stripArcMarkers', () => {
  it('removes every _arc* key and keeps the rest', () => {
    expect(
      stripArcMarkers({ port_size: '1G', _arcMirroredFromItemId: 'item-1', [ARC_PRICE_FROZEN_KEY]: true, [ARC_REPRICED_KEY]: true }),
    ).toEqual({ port_size: '1G' })
    expect(stripArcMarkers(null)).toEqual({})
  })
})

describe('stripQuoteOnlyArcMarkers', () => {
  it('removes the freeze and re-priced flags and keeps the descriptive markers', () => {
    expect(
      stripQuoteOnlyArcMarkers({
        port_size: '1G',
        _arcMirroredFromItemId: 'item-1',
        [ARC_PRICE_FROZEN_KEY]: true,
        [ARC_REPRICED_KEY]: true,
      }),
    ).toEqual({ port_size: '1G', _arcMirroredFromItemId: 'item-1' })
  })

  it('returns the input untouched when there is no quote-only marker', () => {
    const cfg = { port_size: '1G' }
    expect(stripQuoteOnlyArcMarkers(cfg)).toBe(cfg)
    expect(stripQuoteOnlyArcMarkers(null)).toBeNull()
  })
})

describe('freeze matrix (Amend always; Renew only for a cost-plus item)', () => {
  it.each([
    ['amend', true],
    ['renew', false],
    ['cancel', false],
  ] as const)('%s mirror configuration frozen=%s, and only an Amend quote honours the marker', (quoteType, frozen) => {
    const cfg = buildArcMirrorConfiguration({ port_size: '1G' }, ITEM, quoteType)
    expect(isArcPriceFrozen(cfg)).toBe(frozen)
    expect(isFrozenMirrorLine(cfg, quoteType)).toBe(frozen)
    // the freeze marker is quote-only: it never reaches an order / subscription configuration
    expect(stripQuoteOnlyArcMarkers(cfg)).not.toHaveProperty(ARC_PRICE_FROZEN_KEY)
  })

  it('a Renew line carrying the marker is still not a frozen mirror line', () => {
    expect(isFrozenMirrorLine({ _arcMirroredFromItemId: 'item-1', [ARC_PRICE_FROZEN_KEY]: true }, 'renew')).toBe(false)
  })
})

describe('Renew freeze of cost-plus items (Q4)', () => {
  it('freezes a Renew mirror line only when the item is cost-plus, with both markers', () => {
    const cfg = buildArcMirrorConfiguration({ port_size: '1G' }, ITEM, 'renew', { costPlus: true })
    expect(cfg).toMatchObject({ [ARC_PRICE_FROZEN_KEY]: true, [ARC_COST_PLUS_FROZEN_KEY]: true, _arcMirroredFromItemId: 'item-1' })
    expect(isFrozenMirrorLine(cfg, 'renew')).toBe(true)
    const plain = buildArcMirrorConfiguration({ port_size: '1G' }, ITEM, 'renew', { costPlus: false })
    expect(plain).not.toHaveProperty(ARC_COST_PLUS_FROZEN_KEY)
    expect(isFrozenMirrorLine(plain, 'renew')).toBe(false)
  })

  it('never freezes a Cancel line, and the cost-plus flag does not change Amend', () => {
    expect(isFrozenMirrorLine(buildArcMirrorConfiguration({}, ITEM, 'cancel', { costPlus: true }), 'cancel')).toBe(false)
    const amend = buildArcMirrorConfiguration({}, ITEM, 'amend', { costPlus: true })
    expect(amend).not.toHaveProperty(ARC_COST_PLUS_FROZEN_KEY)
    expect(isFrozenMirrorLine(amend, 'amend')).toBe(true)
  })

  it('honours the Renew freeze only on a Renew quote, only with both markers and a mirror id', () => {
    const cfg = buildArcMirrorConfiguration({}, ITEM, 'renew', { costPlus: true })
    expect(isFrozenMirrorLine(cfg, 'amend')).toBe(true)
    expect(isFrozenMirrorLine(cfg, 'new')).toBe(false)
    expect(isFrozenMirrorLine({ ...cfg, [ARC_COST_PLUS_FROZEN_KEY]: undefined }, 'renew')).toBe(false)
    expect(isFrozenMirrorLine({ [ARC_PRICE_FROZEN_KEY]: true, [ARC_COST_PLUS_FROZEN_KEY]: true }, 'renew')).toBe(false)
  })

  it('keeps both markers and the reconfigured marker off orders and items', () => {
    const cfg = { ...buildArcMirrorConfiguration({ port_size: '1G' }, ITEM, 'renew', { costPlus: true }), [ARC_RECONFIGURED_KEY]: true }
    expect(stripQuoteOnlyArcMarkers(cfg)).toEqual({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' })
  })
})
