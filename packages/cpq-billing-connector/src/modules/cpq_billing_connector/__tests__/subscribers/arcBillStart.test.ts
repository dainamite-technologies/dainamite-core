import { buildAddedItemPayloads, type AmendedPayload } from '../../subscribers/cpq-subscription-amended'
import { buildRenewedItemPayloads, type RenewedPayload } from '../../subscribers/cpq-subscription-renewed'

const added = [
  {
    subscriptionItemId: 'si-1',
    orderLineId: 'ol-1',
    productName: 'Static IP',
    quantity: 1,
    charges: [{ type: 'recurring' as const, unitPrice: 30, description: 'Recurring charge' }],
  },
  {
    subscriptionItemId: 'si-2',
    orderLineId: 'ol-2',
    startDate: '2026-12-10',
    productName: 'Backup',
    quantity: 1,
    charges: [{ type: 'one_time' as const, amount: 99, description: 'One-time charge' }],
  },
  {
    subscriptionItemId: 'si-3',
    productName: 'Unmatched',
    quantity: 1,
    charges: [{ type: 'recurring' as const, unitPrice: 5, description: 'Recurring charge' }],
  },
]

const starts = (items: Array<{ subscriptionItemId?: string; billStartDate: Date | string }>) =>
  items.map((i) => [i.subscriptionItemId, i.billStartDate])

describe('ARC bill start per added line (phase 2)', () => {
  const amended: AmendedPayload = {
    tenantId: 't',
    organizationId: 'o',
    subscriptionId: 'sub-1',
    customerId: 'c',
    effectiveDate: '2026-11-20',
    addedItems: added,
    sourceOrderId: 'order-1',
  }

  it('amend: override → service start → order default → effective date', () => {
    const setup = { defaultBillStartDate: '2026-12-01', lineBillStarts: { 'ol-1': '2026-12-15' } }
    expect(starts(buildAddedItemPayloads('acc', amended, setup))).toEqual([
      ['si-1', '2026-12-15'],
      ['si-2', '2026-12-10'],
      ['si-3', '2026-12-01'],
    ])
  })

  it('amend without a setup keeps today’s behaviour except for a service start', () => {
    expect(starts(buildAddedItemPayloads('acc', amended))).toEqual([
      ['si-1', '2026-11-20'],
      ['si-2', '2026-12-10'],
      ['si-3', '2026-11-20'],
    ])
  })

  it('renew: falls back to the new term start and bills to the given account', () => {
    const renewed: RenewedPayload = {
      tenantId: 't',
      organizationId: 'o',
      subscriptionId: 'sub-1',
      customerId: 'c',
      newTermStart: '2027-01-01',
      addedItems: added,
    }
    const payloads = buildRenewedItemPayloads('acc-sub', renewed, { lineBillStarts: { 'ol-1': '2027-02-01' } })
    expect(starts(payloads)).toEqual([
      ['si-1', '2027-02-01'],
      ['si-2', '2026-12-10'],
      ['si-3', '2027-01-01'],
    ])
    expect(new Set(payloads.map((p) => p.billAccountId))).toEqual(new Set(['acc-sub']))
  })
})
