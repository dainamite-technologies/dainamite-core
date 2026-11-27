/**
 * Contract tests for every CPQ AI tool: input schema, the operation built
 * from the input, response mapping, and RBAC parity with the backing route.
 */
import { createAiApiOperationRunner } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { aiTools } from '../../ai-tools'
import features from '../../acl'
import {
  ASSET_ID,
  CUSTOMER_ID,
  FakeApi,
  LINE_ID,
  OFFERING_ID,
  OFFERING_ID_2,
  ORDER_ID,
  QUOTE_ID,
  SPEC_ID,
  SUBSCRIPTION_ID,
  getTool,
  makeCtx,
  readRouteFeatures,
  routeFileToPathPattern,
} from './harness'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => {
  const actual = jest.requireActual('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner')
  return { ...actual, createAiApiOperationRunner: jest.fn() }
})

const mockedCreateRunner = jest.mocked(createAiApiOperationRunner)

/** Mutation handlers only run from the pending-action executor, which sets `approvedPendingActionId`. */
function ctxFor(entry: { mutation: boolean }) {
  return entry.mutation ? makeCtx({ approvedPendingActionId: 'pending-action-1' }) : makeCtx()
}

let api: FakeApi
beforeEach(() => {
  api = new FakeApi()
  mockedCreateRunner.mockReset()
  mockedCreateRunner.mockImplementation(() => ({ run: api.run }) as unknown as ReturnType<typeof createAiApiOperationRunner>)
})

const PAGED = { items: [{ id: 'row-1' }], total: 1, page: 2, pageSize: 10, totalPages: 1 }

const SAMPLE_QUOTE = {
  id: QUOTE_ID,
  quoteId: '77777777-7777-4777-8777-777777777777',
  quoteNumber: 'QUOTE-20261116-00001',
  customerId: CUSTOMER_ID,
  cpqStatus: 'ready',
  version: 1,
  pricingRevision: 3,
  currencyCode: 'EUR',
  pricingSummary: { nrcTotal: 100, mrcTotal: 50 },
  lines: [
    {
      lineId: LINE_ID,
      offeringId: OFFERING_ID,
      quantity: 1,
      configuration: { bandwidth: '100M', site: 'WAW1' },
      startDate: null,
      termMonths: 12,
      endDate: null,
      nrcTotal: 100,
      mrcTotal: 50,
    },
  ],
}

type ToolCase = {
  name: string
  routeFile: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  mutation: boolean
  /** Extra features beyond the route's own (preview reads). */
  extraFeatures?: string[]
  input: Record<string, unknown>
  invalidInput: Record<string, unknown>
  expectedPath: string
  expectedQuery?: Record<string, unknown>
  expectedBody?: Record<string, unknown>
  /** Responses the fake API serves (the main operation plus any preview GET). */
  arrange: (fake: FakeApi) => void
  expectedOutput: unknown
}

const cases: ToolCase[] = [
  // ─── catalog ─────────────────────────────────────────────────────────────
  {
    name: 'cpq.list_offerings',
    routeFile: 'product-offerings/route.ts',
    method: 'GET',
    mutation: false,
    input: { search: '  fibre ', offeringType: 'bundle', isActive: true, isSellable: true, page: 2, pageSize: 10, sortField: 'name', sortDir: 'asc' },
    invalidInput: { pageSize: 101 },
    expectedPath: '/cpq/product-offerings',
    expectedQuery: { search: 'fibre', offeringType: 'bundle', isActive: true, isSellable: true, page: 2, pageSize: 10, sortField: 'name', sortDir: 'asc' },
    arrange: (fake) => fake.on('GET', '/cpq/product-offerings', PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.get_offering',
    routeFile: 'product-offerings/route.ts',
    method: 'GET',
    mutation: false,
    input: { offeringId: OFFERING_ID },
    invalidInput: { offeringId: 'not-a-uuid' },
    expectedPath: '/cpq/product-offerings',
    expectedQuery: { id: OFFERING_ID },
    arrange: (fake) => fake.on('GET', '/cpq/product-offerings', { id: OFFERING_ID, charges: [] }),
    expectedOutput: { offering: { id: OFFERING_ID, charges: [] } },
  },
  {
    name: 'cpq.get_bundle_tree',
    routeFile: 'bundle-tree/route.ts',
    method: 'GET',
    mutation: false,
    input: { offeringId: OFFERING_ID },
    invalidInput: {},
    expectedPath: '/cpq/bundle-tree',
    expectedQuery: { offeringId: OFFERING_ID },
    arrange: (fake) => fake.on('GET', '/cpq/bundle-tree', { tree: { slots: [] }, validation: { valid: true } }),
    expectedOutput: { tree: { slots: [] }, validation: { valid: true } },
  },
  {
    name: 'cpq.list_specifications',
    routeFile: 'product-specifications/route.ts',
    method: 'GET',
    mutation: false,
    input: { specType: 'simple', lifecycleStatus: 'active' },
    invalidInput: { specType: 'composite' },
    expectedPath: '/cpq/product-specifications',
    expectedQuery: { specType: 'simple', lifecycleStatus: 'active' },
    arrange: (fake) => fake.on('GET', '/cpq/product-specifications', PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.get_specification',
    routeFile: 'product-specifications/route.ts',
    method: 'GET',
    mutation: false,
    input: { specificationId: SPEC_ID },
    invalidInput: { specificationId: 42 },
    expectedPath: '/cpq/product-specifications',
    expectedQuery: { id: SPEC_ID },
    arrange: (fake) => fake.on('GET', '/cpq/product-specifications', { id: SPEC_ID, attributes: [{ code: 'bandwidth' }] }),
    expectedOutput: { specification: { id: SPEC_ID, attributes: [{ code: 'bandwidth' }] } },
  },
  {
    name: 'cpq.get_configurable_attributes',
    routeFile: 'quotes/attributes/route.ts',
    method: 'GET',
    mutation: false,
    input: { offeringId: OFFERING_ID, configuration: { bandwidth: '100M' } },
    invalidInput: { configuration: {} },
    expectedPath: '/cpq/quotes/attributes',
    expectedQuery: { offeringId: OFFERING_ID, configuration: JSON.stringify({ bandwidth: '100M' }) },
    arrange: (fake) => fake.on('GET', '/cpq/quotes/attributes', { attributes: [{ code: 'site' }] }),
    expectedOutput: { attributes: [{ code: 'site' }] },
  },
  // ─── pricing ─────────────────────────────────────────────────────────────
  {
    name: 'cpq.calculate_price',
    routeFile: 'quotes/price/route.ts',
    method: 'POST',
    mutation: false,
    input: {
      primaryItem: { offeringId: OFFERING_ID, configuration: { bandwidth: '100M' } },
      childItems: [{ offeringId: OFFERING_ID_2, configuration: {} }],
      currencyCode: 'eur',
      includeWaterfall: true,
    },
    invalidInput: { primaryItem: { offeringId: OFFERING_ID } },
    expectedPath: '/cpq/quotes/price',
    expectedBody: {
      primaryItem: { offeringId: OFFERING_ID, configuration: { bandwidth: '100M' } },
      childItems: [{ offeringId: OFFERING_ID_2, configuration: {} }],
      currencyCode: 'EUR',
      includeWaterfall: true,
    },
    arrange: (fake) =>
      fake.on('POST', '/cpq/quotes/price', {
        primaryCharges: [{ chargeCode: 'MRC', totalPrice: 50 }],
        childItems: [],
        totals: { nrcTotal: 100, mrcTotal: 50, usageCharges: [] },
        currencyCode: 'EUR',
      }),
    expectedOutput: {
      currencyCode: 'EUR',
      totals: { nrcTotal: 100, mrcTotal: 50, usageCharges: [] },
      primaryCharges: [{ chargeCode: 'MRC', totalPrice: 50 }],
      childItems: [],
    },
  },
  {
    name: 'cpq.validate_configuration',
    routeFile: 'quotes/validate-relationships/route.ts',
    method: 'POST',
    mutation: false,
    input: { offeringIds: [OFFERING_ID, OFFERING_ID_2], parentChildPairs: [{ parentOfferingId: OFFERING_ID, childOfferingId: OFFERING_ID_2 }] },
    invalidInput: { offeringIds: [] },
    expectedPath: '/cpq/quotes/validate-relationships',
    expectedBody: { offeringIds: [OFFERING_ID, OFFERING_ID_2], parentChildPairs: [{ parentOfferingId: OFFERING_ID, childOfferingId: OFFERING_ID_2 }] },
    arrange: (fake) => fake.on('POST', '/cpq/quotes/validate-relationships', { valid: false, errors: [{ message: 'excludes' }], allowedChildSpecs: [] }),
    expectedOutput: { valid: false, errors: [{ message: 'excludes' }], allowedChildSpecs: [] },
  },
  {
    name: 'cpq.list_price_rules',
    routeFile: 'price-rules/route.ts',
    method: 'GET',
    mutation: false,
    input: { offeringId: OFFERING_ID, ruleType: 'discount_percent' },
    invalidInput: { ruleType: 'cashback' },
    expectedPath: '/cpq/price-rules',
    expectedQuery: { productOfferingId: OFFERING_ID, ruleType: 'discount_percent' },
    arrange: (fake) => fake.on('GET', '/cpq/price-rules', PAGED),
    expectedOutput: PAGED,
  },
  // ─── quotes (read) ───────────────────────────────────────────────────────
  {
    name: 'cpq.list_quotes',
    routeFile: 'quotes/route.ts',
    method: 'GET',
    mutation: false,
    input: { customerId: CUSTOMER_ID, cpqStatus: 'in_approval', currencyCode: 'usd' },
    invalidInput: { cpqStatus: 'draft' },
    expectedPath: '/cpq/quotes',
    expectedQuery: { customerId: CUSTOMER_ID, cpqStatus: 'in_approval', currencyCode: 'USD' },
    arrange: (fake) => fake.on('GET', '/cpq/quotes', PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.get_quote',
    routeFile: 'quotes/[quoteId]/route.ts',
    method: 'GET',
    mutation: false,
    input: { quoteId: QUOTE_ID },
    invalidInput: { quoteId: '' },
    expectedPath: `/cpq/quotes/${QUOTE_ID}`,
    arrange: (fake) => fake.on('GET', `/cpq/quotes/${QUOTE_ID}`, SAMPLE_QUOTE),
    expectedOutput: { quote: SAMPLE_QUOTE },
  },
  // ─── quotes (mutations) ──────────────────────────────────────────────────
  {
    name: 'cpq.create_quote',
    routeFile: 'quotes/route.ts',
    method: 'POST',
    mutation: true,
    input: { customerId: CUSTOMER_ID, currencyCode: 'eur' },
    invalidInput: { customerId: CUSTOMER_ID, quoteType: 'amend' },
    expectedPath: '/cpq/quotes',
    expectedBody: { customerId: CUSTOMER_ID, quoteType: 'new', currencyCode: 'EUR' },
    arrange: (fake) => fake.on('POST', '/cpq/quotes', { id: QUOTE_ID, cpqStatus: 'new' }, 201),
    expectedOutput: { quote: { id: QUOTE_ID, cpqStatus: 'new' } },
  },
  {
    name: 'cpq.add_quote_line',
    routeFile: 'quotes/[quoteId]/items/route.ts',
    method: 'POST',
    mutation: true,
    // quotes.view: quote preview; offerings.view: bundle-tree read for the default-line count.
    extraFeatures: ['cpq.quotes.view', 'cpq.offerings.view'],
    input: { quoteId: QUOTE_ID, offeringId: OFFERING_ID, configuration: { bandwidth: '1G' }, quantity: 2, termMonths: 24, expandBundleDefaults: true },
    invalidInput: { quoteId: QUOTE_ID, offeringId: OFFERING_ID, configuration: {}, quantity: 0 },
    expectedPath: `/cpq/quotes/${QUOTE_ID}/items`,
    expectedBody: { offeringId: OFFERING_ID, configuration: { bandwidth: '1G' }, action: 'add', quantity: 2, termMonths: 24, expandBundleDefaults: true },
    arrange: (fake) => fake.on('POST', `/cpq/quotes/${QUOTE_ID}/items`, { id: QUOTE_ID, lines: [] }, 201),
    expectedOutput: { quote: { id: QUOTE_ID, lines: [] } },
  },
  // ─── catalog writes (#128) ───────────────────────────────────────────────
  {
    name: 'cpq.create_offering',
    routeFile: 'product-offerings/route.ts',
    method: 'POST',
    mutation: true,
    // specifications.view: the preview reads the specification.
    extraFeatures: ['cpq.specifications.view'],
    input: { specId: SPEC_ID, code: ' ont-basic ', name: 'ONT basic', lifecycleStatus: 'active', isSellable: false },
    invalidInput: { specId: SPEC_ID, code: 'x', name: 'x', offeringType: 'bundle' },
    expectedPath: '/cpq/product-offerings',
    expectedBody: { specId: SPEC_ID, code: 'ont-basic', name: 'ONT basic', lifecycleStatus: 'active', isSellable: false },
    arrange: (fake) => fake.on('POST', '/cpq/product-offerings', { id: OFFERING_ID, code: 'ont-basic' }, 201),
    expectedOutput: { offering: { id: OFFERING_ID, code: 'ont-basic' } },
  },
  {
    name: 'cpq.add_bundle_component',
    routeFile: 'offering-components/route.ts',
    method: 'POST',
    mutation: true,
    // offerings.view + specifications.view: the preview reads both offerings and the slot.
    extraFeatures: ['cpq.offerings.view', 'cpq.specifications.view'],
    input: { offeringId: OFFERING_ID, slotId: SPEC_ID, childOfferingId: OFFERING_ID_2, isDefault: true },
    invalidInput: { offeringId: OFFERING_ID, slotId: 'not-a-uuid', childOfferingId: OFFERING_ID_2 },
    expectedPath: '/cpq/offering-components',
    expectedBody: { offeringId: OFFERING_ID, slotId: SPEC_ID, childOfferingId: OFFERING_ID_2, isDefault: true },
    arrange: (fake) => fake.on('POST', '/cpq/offering-components', { id: LINE_ID }, 201),
    expectedOutput: { component: { id: LINE_ID } },
  },
  {
    name: 'cpq.remove_bundle_component',
    routeFile: 'offering-components/route.ts',
    method: 'DELETE',
    mutation: true,
    // offerings.view: the bundle is read to check the component belongs to it.
    extraFeatures: ['cpq.offerings.view'],
    input: { offeringId: OFFERING_ID, componentId: LINE_ID },
    invalidInput: { offeringId: OFFERING_ID },
    expectedPath: '/cpq/offering-components',
    expectedBody: { id: LINE_ID },
    arrange: (fake) =>
      fake
        .on('GET', '/cpq/product-offerings', { id: OFFERING_ID, components: [{ id: LINE_ID, childOfferingId: OFFERING_ID_2 }] })
        .on('DELETE', '/cpq/offering-components', { success: true }),
    expectedOutput: { removed: true, componentId: LINE_ID },
  },
  {
    name: 'cpq.update_quote_line',
    routeFile: 'quotes/[quoteId]/items/[lineId]/route.ts',
    method: 'PUT',
    mutation: true,
    extraFeatures: ['cpq.quotes.view'],
    input: { quoteId: QUOTE_ID, lineId: LINE_ID, configuration: { bandwidth: '1G' }, quantity: 3 },
    invalidInput: { quoteId: QUOTE_ID, lineId: LINE_ID, unknownField: true },
    expectedPath: `/cpq/quotes/${QUOTE_ID}/items/${LINE_ID}`,
    // Merged over the current line: `site` and termMonths survive.
    expectedBody: { configuration: { bandwidth: '1G', site: 'WAW1' }, quantity: 3, termMonths: 12 },
    arrange: (fake) =>
      fake
        .on('GET', `/cpq/quotes/${QUOTE_ID}`, SAMPLE_QUOTE)
        .on('PUT', `/cpq/quotes/${QUOTE_ID}/items/${LINE_ID}`, { id: QUOTE_ID }),
    expectedOutput: { quote: { id: QUOTE_ID } },
  },
  {
    name: 'cpq.submit_quote_for_approval',
    routeFile: 'quotes/[quoteId]/status/route.ts',
    method: 'POST',
    mutation: true,
    extraFeatures: ['cpq.quotes.view'],
    input: { quoteId: QUOTE_ID },
    invalidInput: { quoteId: QUOTE_ID, targetStatus: 'accepted' },
    expectedPath: `/cpq/quotes/${QUOTE_ID}/status`,
    expectedBody: { targetStatus: 'in_approval' },
    arrange: (fake) =>
      fake
        .on('GET', `/cpq/quotes/${QUOTE_ID}`, SAMPLE_QUOTE)
        .on('POST', `/cpq/quotes/${QUOTE_ID}/status`, { id: QUOTE_ID, cpqStatus: 'in_approval' }),
    expectedOutput: { quote: { id: QUOTE_ID, cpqStatus: 'in_approval' } },
  },
  // ─── inventory ───────────────────────────────────────────────────────────
  {
    name: 'cpq.list_subscriptions',
    routeFile: 'inventory/subscriptions/route.ts',
    method: 'GET',
    mutation: false,
    input: { customerId: CUSTOMER_ID, statuses: ['active', 'suspended'], expiringWithinDays: 90 },
    invalidInput: { statuses: ['bogus'] },
    expectedPath: '/cpq/inventory/subscriptions',
    expectedQuery: { customerId: CUSTOMER_ID, status: 'active,suspended', expiringWithinDays: 90 },
    arrange: (fake) => fake.on('GET', '/cpq/inventory/subscriptions', PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.get_subscription',
    routeFile: 'inventory/subscriptions/route.ts',
    method: 'GET',
    mutation: false,
    input: { subscriptionId: SUBSCRIPTION_ID },
    invalidInput: {},
    expectedPath: '/cpq/inventory/subscriptions',
    expectedQuery: { id: SUBSCRIPTION_ID },
    arrange: (fake) => fake.on('GET', '/cpq/inventory/subscriptions', { id: SUBSCRIPTION_ID, items: [] }),
    expectedOutput: { subscription: { id: SUBSCRIPTION_ID, items: [] } },
  },
  {
    name: 'cpq.list_assets',
    routeFile: 'inventory/assets/route.ts',
    method: 'GET',
    mutation: false,
    input: { subscriptionId: SUBSCRIPTION_ID, assetType: 'license' },
    invalidInput: { assetType: 'virtual' },
    expectedPath: '/cpq/inventory/assets',
    expectedQuery: { subscriptionId: SUBSCRIPTION_ID, assetType: 'license' },
    arrange: (fake) => fake.on('GET', '/cpq/inventory/assets', PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.get_asset',
    routeFile: 'inventory/assets/route.ts',
    method: 'GET',
    mutation: false,
    input: { assetId: ASSET_ID },
    invalidInput: { assetId: 'x' },
    expectedPath: '/cpq/inventory/assets',
    expectedQuery: { id: ASSET_ID },
    arrange: (fake) => fake.on('GET', '/cpq/inventory/assets', { id: ASSET_ID }),
    expectedOutput: { asset: { id: ASSET_ID } },
  },
  {
    name: 'cpq.get_customer_inventory',
    routeFile: 'inventory/customer/[customerId]/route.ts',
    method: 'GET',
    mutation: false,
    input: { customerId: CUSTOMER_ID, includeTerminated: true },
    invalidInput: { customerId: 'acme' },
    expectedPath: `/cpq/inventory/customer/${CUSTOMER_ID}`,
    expectedQuery: { includeTerminated: true },
    arrange: (fake) => fake.on('GET', `/cpq/inventory/customer/${CUSTOMER_ID}`, { subscriptions: [], assets: [] }),
    expectedOutput: { customerId: CUSTOMER_ID, inventory: { subscriptions: [], assets: [] } },
  },
  {
    name: 'cpq.list_expiring_subscriptions',
    routeFile: 'inventory/subscriptions/expiring/route.ts',
    method: 'GET',
    mutation: false,
    input: { withinDays: 60, billingCycle: 'annually' },
    invalidInput: { withinDays: 400 },
    expectedPath: '/cpq/inventory/subscriptions/expiring',
    expectedQuery: { withinDays: 60, billingCycle: 'annually' },
    arrange: (fake) => fake.on('GET', '/cpq/inventory/subscriptions/expiring', PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.get_subscription_change_log',
    routeFile: 'inventory/subscriptions/[subscriptionId]/change-log/route.ts',
    method: 'GET',
    mutation: false,
    input: { subscriptionId: SUBSCRIPTION_ID, pageSize: 20 },
    invalidInput: { subscriptionId: SUBSCRIPTION_ID, pageSize: 500 },
    expectedPath: `/cpq/inventory/subscriptions/${SUBSCRIPTION_ID}/change-log`,
    expectedQuery: { pageSize: 20 },
    arrange: (fake) => fake.on('GET', `/cpq/inventory/subscriptions/${SUBSCRIPTION_ID}/change-log`, PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.change_subscription_status',
    routeFile: 'inventory/subscriptions/actions/route.ts',
    method: 'POST',
    mutation: true,
    // inventory.view: the preview reads the subscription.
    extraFeatures: ['cpq.inventory.view'],
    input: { subscriptionId: SUBSCRIPTION_ID, action: 'suspend', chargeBehavior: 'no_charge', reason: 'Non-payment' },
    invalidInput: { subscriptionId: SUBSCRIPTION_ID, action: 'hibernate' },
    expectedPath: '/cpq/inventory/subscriptions/actions',
    expectedBody: { subscriptionId: SUBSCRIPTION_ID, action: 'suspend', chargeBehavior: 'no_charge', reason: 'Non-payment' },
    arrange: (fake) => fake.on('POST', '/cpq/inventory/subscriptions/actions', { subscriptionItemIds: [ASSET_ID] }),
    expectedOutput: { subscriptionItemIds: [ASSET_ID] },
  },
  // ─── orders ──────────────────────────────────────────────────────────────
  {
    name: 'cpq.list_orders',
    routeFile: 'orders/route.ts',
    method: 'GET',
    mutation: false,
    input: { cpqStatus: 'pending_activation', sourceQuoteId: QUOTE_ID },
    invalidInput: { cpqStatus: 'shipped' },
    expectedPath: '/cpq/orders',
    expectedQuery: { cpqStatus: 'pending_activation', sourceQuoteId: QUOTE_ID },
    arrange: (fake) => fake.on('GET', '/cpq/orders', PAGED),
    expectedOutput: PAGED,
  },
  {
    name: 'cpq.get_order',
    routeFile: 'orders/[orderId]/route.ts',
    method: 'GET',
    mutation: false,
    input: { orderId: ORDER_ID },
    invalidInput: { orderId: null },
    expectedPath: `/cpq/orders/${ORDER_ID}`,
    arrange: (fake) => fake.on('GET', `/cpq/orders/${ORDER_ID}`, { id: ORDER_ID, lines: [] }),
    expectedOutput: { order: { id: ORDER_ID, lines: [] } },
  },
]

describe('CPQ AI tool registry', () => {
  it('registers every tool exactly once and covers every case in this file', () => {
    const names = aiTools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(cases.map((entry) => entry.name).sort())
  })

  it('names every tool cpq.<verb>_<noun> and documents it', () => {
    for (const tool of aiTools) {
      expect(tool.name).toMatch(/^cpq\.[a-z]+(_[a-z]+)+$/)
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.description).toMatch(/Returns/)
    }
  })

  it('declares every required feature in acl.ts', () => {
    const declared = new Set<string>(features.map((feature) => feature.id))
    for (const tool of aiTools) {
      expect(tool.requiredFeatures?.length).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures ?? []) expect(declared.has(feature)).toBe(true)
    }
  })

  it('describes every top-level input field for the model', () => {
    for (const tool of aiTools) {
      const shape = (tool.inputSchema as unknown as { shape?: Record<string, { description?: string }> }).shape
      expect(shape).toBeDefined()
      for (const [field, schema] of Object.entries(shape ?? {})) {
        expect({ tool: tool.name, field, described: Boolean(schema.description) }).toEqual({
          tool: tool.name,
          field,
          described: true,
        })
      }
    }
  })
})

describe.each(cases)('$name', (entry) => {
  const tool = getTool(entry.name)

  it('accepts the sample input and rejects an invalid one', () => {
    expect(tool.inputSchema.safeParse(entry.input).success).toBe(true)
    expect(tool.inputSchema.safeParse(entry.invalidInput).success).toBe(false)
  })

  it('requires exactly the backing route features (plus preview reads for mutations)', async () => {
    const routeFeatures = await readRouteFeatures(entry.routeFile)
    const expected = [...(routeFeatures[entry.method] ?? []), ...(entry.extraFeatures ?? [])]
    expect(routeFeatures[entry.method]?.length).toBeGreaterThan(0)
    expect([...(tool.requiredFeatures ?? [])].sort()).toEqual([...new Set(expected)].sort())
  })

  it(entry.mutation ? 'is flagged as a mutation' : 'is not flagged as a mutation', () => {
    expect(tool.isMutation === true).toBe(entry.mutation)
    if (entry.mutation) expect(typeof tool.loadBeforeRecord).toBe('function')
  })

  it('targets a path served by the backing route file', () => {
    expect(entry.expectedPath).toMatch(routeFileToPathPattern(entry.routeFile))
  })

  it('builds the operation and maps the response', async () => {
    entry.arrange(api)
    const parsed = tool.inputSchema.parse(entry.input)
    const output = await tool.handler(parsed, ctxFor(entry))

    const main = api.calls.find((call) => call.method === entry.method && call.path === entry.expectedPath)
    expect(main).toBeDefined()
    if (entry.method === 'GET') {
      expect(main!.query ?? {}).toEqual(entry.expectedQuery ?? {})
      expect(main!.body).toBeUndefined()
    } else {
      expect(main!.body).toEqual(entry.expectedBody)
    }
    expect(output).toEqual(entry.expectedOutput)
    // Writes only ever hit the single backing route.
    expect(api.writes()).toHaveLength(entry.method === 'GET' ? 0 : 1)
  })

  it('surfaces a route error instead of returning data', async () => {
    // The error responder is registered first so it wins for its own path;
    // mutation tools still get their pre-flight reads (the quote, or the
    // bundle offering for cpq.remove_bundle_component) from `arrange`.
    api.on(entry.method, entry.expectedPath, 'Forbidden', 403)
    entry.arrange(api)
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, SAMPLE_QUOTE)
    const parsed = tool.inputSchema.parse(entry.input)
    await expect(tool.handler(parsed, ctxFor(entry))).rejects.toThrow('Forbidden')
  })

  if (entry.mutation) {
    it('refuses to call the write route without an approved pending action (MCP / direct call)', async () => {
      entry.arrange(api)
      const parsed = tool.inputSchema.parse(entry.input)
      await expect(tool.handler(parsed, makeCtx())).rejects.toThrow(/needs approval in the in-app AI chat; it cannot run over MCP/)
      expect(api.writes()).toHaveLength(0)
    })
  }
})
