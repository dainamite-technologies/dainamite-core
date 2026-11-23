import { buildArcAddedItems, buildArcChangedItems, buildArcLineRefs, buildArcRemovedItemIds } from '../cpqOrderService'
import type { ApplyArcResult } from '../cpqInventoryService'

function changeLog(lineChanges: Array<Record<string, unknown>>): ApplyArcResult['changeLog'] {
  return {
    lineChanges,
    afterSnapshot: { items: [{ id: 'si-new', name: 'Static IP' }] },
  } as unknown as ApplyArcResult['changeLog']
}

describe('ARC added items → order lines', () => {
  const refs = buildArcLineRefs([
    { orderLineId: 'ol-1', sourceQuoteLineId: 'ql-1', startDate: '2026-12-01' },
    { orderLineId: 'ol-2', sourceQuoteLineId: null, startDate: null },
  ])

  it('indexes order lines by the quote line they came from', () => {
    expect([...refs.entries()]).toEqual([['ql-1', { orderLineId: 'ol-1', startDate: '2026-12-01' }]])
  })

  it('tags each added item with its order line and service start', () => {
    const items = buildArcAddedItems(
      changeLog([
        { action: 'add', itemId: 'si-new', quoteLineId: 'ql-1', mrcAmount: 30, nrcAmount: 0 },
        { action: 'cancel', itemId: 'si-old', quoteLineId: 'ql-2' },
      ]),
      refs,
    )
    expect(items).toEqual([
      {
        subscriptionItemId: 'si-new',
        orderLineId: 'ol-1',
        startDate: '2026-12-01',
        productName: 'Static IP',
        quantity: 1,
        charges: [{ type: 'recurring', unitPrice: 30, description: 'Recurring charge' }],
      },
    ])
  })

  it('omits the order line fields when no order line matches (payload stays backward compatible)', () => {
    const [item] = buildArcAddedItems(
      changeLog([{ action: 'add', itemId: 'si-new', quoteLineId: 'ql-unknown', mrcAmount: 30 }]),
      refs,
    )
    expect(item).not.toHaveProperty('orderLineId')
    expect(item).not.toHaveProperty('startDate')
    expect(buildArcAddedItems(changeLog([{ action: 'add', itemId: 'si-new', mrcAmount: 30 }]))[0]).not.toHaveProperty(
      'orderLineId',
    )
  })
})

describe('ARC billing payloads for devices and price changes (#126)', () => {
  it('bills an added device by its asset id, with its one-time price', () => {
    const items = buildArcAddedItems(
      changeLog([{ action: 'add_asset', assetId: 'asset-ont', name: 'ONT', quoteLineId: 'ql-1', mrcAmount: 0, nrcAmount: 99 }]),
      buildArcLineRefs([{ orderLineId: 'ol-1', sourceQuoteLineId: 'ql-1', startDate: null }]),
    )
    expect(items).toEqual([
      {
        subscriptionItemId: 'asset-ont',
        orderLineId: 'ol-1',
        productName: 'ONT',
        quantity: 1,
        charges: [{ type: 'one_time', amount: 99, description: 'One-time charge' }],
      },
    ])
  })

  it('stops billing cancelled items and returned devices', () => {
    expect(
      buildArcRemovedItemIds(
        changeLog([
          { action: 'cancel', itemId: 'si-old' },
          { action: 'retire_asset', assetId: 'asset-ont', status: 'returned' },
          { action: 'modify', itemId: 'si-kept', mrcDelta: 0 },
        ]),
      ),
    ).toEqual(['si-old', 'asset-ont'])
  })

  it('re-rates only modify lines whose recurring price changed, never their one-time charge', () => {
    const items = buildArcChangedItems(
      changeLog([
        { action: 'modify', itemId: 'si-new', mrcDelta: 20, mrcAmount: 70 },
        { action: 'modify', itemId: 'si-same', mrcDelta: 0, mrcAmount: 50 },
        { action: 'modify', itemId: 'si-free', mrcDelta: -10, mrcAmount: 0 },
        { action: 'add', itemId: 'si-added', mrcAmount: 5 },
      ]),
    )
    expect(items).toEqual([
      { subscriptionItemId: 'si-new', productName: 'Static IP', quantity: 1, charges: [{ type: 'recurring', unitPrice: 70, description: 'Recurring charge' }] },
      { subscriptionItemId: 'si-free', productName: 'Configured item', quantity: 1, charges: [] },
    ])
  })

  it('ignores change logs written before the new amount was recorded', () => {
    expect(buildArcChangedItems(changeLog([{ action: 'modify', itemId: 'si-new', mrcDelta: 20 }]))).toEqual([])
  })
})

