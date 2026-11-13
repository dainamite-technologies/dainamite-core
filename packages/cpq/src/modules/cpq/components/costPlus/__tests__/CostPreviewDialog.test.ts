import { buildPreviewConfiguration } from '../CostPreviewDialog'

const attrs = [
  { code: 'seats', name: 'Seats', attributeType: 'number', options: null },
  { code: 'tier', name: 'Tier', attributeType: 'select', options: [{ value: 'gold', label: 'Gold' }] },
  { code: 'ha', name: 'HA', attributeType: 'boolean', options: null },
  { code: 'note', name: 'Note', attributeType: 'text', options: null },
]

it('types the typed values and skips empty or invalid ones', () => {
  expect(buildPreviewConfiguration(attrs, { seats: '12', tier: 'gold', ha: 'false', note: '' })).toEqual({ seats: 12, tier: 'gold', ha: false })
  expect(buildPreviewConfiguration(attrs, { seats: 'abc', ha: 'true', note: 'hi' })).toEqual({ ha: true, note: 'hi' })
})
