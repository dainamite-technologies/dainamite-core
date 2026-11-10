/** OpenAPI request schemas shared by the quote line routes (`items`, `items/{lineId}`). */

const USAGE_ESTIMATES = {
  type: 'array',
  items: {
    type: 'object',
    required: ['chargeCode', 'estimatedQuantity'],
    properties: {
      chargeCode: { type: 'string' },
      estimatedQuantity: { type: 'number', minimum: 0 },
    },
  },
} as const

const LINE_FIELDS = {
  configuration: { type: 'object', additionalProperties: true, description: 'Attribute values of the offering' },
  quantity: { type: 'integer', minimum: 1 },
  usageEstimates: USAGE_ESTIMATES,
  startDate: { type: 'string', format: 'date' },
  termMonths: { type: 'integer', minimum: 1 },
  endDate: { type: 'string', format: 'date' },
  targetSubscriptionId: { type: 'string', format: 'uuid', nullable: true },
  sourceSubscriptionItemId: { type: 'string', format: 'uuid', nullable: true },
} as const

export const QUOTE_ITEM_REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    offeringId: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    action: { type: 'string', enum: ['add', 'modify', 'cancel'] },
    parentLineId: { type: 'string', format: 'uuid' },
    ...LINE_FIELDS,
  },
} as const

export const QUOTE_ITEM_UPDATE_SCHEMA = {
  type: 'object',
  required: ['configuration'],
  properties: { ...LINE_FIELDS },
} as const
