import { buildArcAddedItems, buildArcLineRefs } from '../cpqOrderService'
import type { ApplyArcResult } from '../cpqInventoryService'

function changeLog(lineChanges: Array<Record<string, unknown>>): ApplyArcResult['changeLog'] {
  return {
    lineChanges,
    afterSnapshot: { items: [{ id: 'si-new', name: 'Static IP' }] },
  } as unknown as ApplyArcResult['changeLog']
}

describe('ARC added items → order lines', () => {
  const refs = buildArcLineRefs([
    { orderLineId: 'ol-1', sourceQuoteLineId: 'ql-1', startDate: new Date('2026-12-01T00:00:00Z') },
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
