/**
 * Mutation-approval contract for the CPQ write tools: preview snapshots
 * (`loadBeforeRecord`), stale-version fingerprints, guard rails, and parity
 * of the built request bodies with the routes' own Zod validators.
 */
import { createAiApiOperationRunner } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import {
  cpqAddQuoteItemSchema,
  cpqCreateQuoteSchema,
  cpqPricePreviewSchema,
  cpqTransitionStatusSchema,
  cpqUpdateQuoteItemSchema,
  cpqValidateRelationshipsSchema,
} from '../../data/validators'
import { quoteRecordVersion, type CpqQuoteSnapshot } from '../../ai-tools/_shared'
import { CPQ_QUOTE_MUTATION_TOOL_NAMES, mergeLinePatch } from '../../ai-tools/quotes-pack'
import { CPQ_CATALOG_WRITE_TOOL_NAMES } from '../../ai-tools/catalog-write-pack'
import { cpqOfferingComponentCreateSchema, cpqProductOfferingCreateSchema } from '../../data/validators'
import { aiTools } from '../../ai-tools'
import {
  CUSTOMER_ID,
  FakeApi,
  LINE_ID,
  OFFERING_ID,
  OFFERING_ID_2,
  QUOTE_ID,
  SPEC_ID,
  getTool,
  makeCtx,
} from './harness'

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => {
  const actual = jest.requireActual('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner')
  return { ...actual, createAiApiOperationRunner: jest.fn() }
})

const mockedCreateRunner = jest.mocked(createAiApiOperationRunner)

const approvedCtx = () => makeCtx({ approvedPendingActionId: 'pending-action-1' })

function quote(overrides: Partial<CpqQuoteSnapshot> = {}): CpqQuoteSnapshot {
  return {
    id: QUOTE_ID,
    quoteNumber: 'QUOTE-1',
    cpqStatus: 'ready',
    version: 1,
    pricingRevision: 2,
    currencyCode: 'EUR',
    lines: [
      {
        lineId: LINE_ID,
        offeringId: OFFERING_ID,
        quantity: 1,
        configuration: { bandwidth: '100M', site: 'WAW1' },
        startDate: null,
        termMonths: 12,
        endDate: null,
      },
    ],
    ...overrides,
  }
}

let api: FakeApi
beforeEach(() => {
  api = new FakeApi()
  mockedCreateRunner.mockReset()
  mockedCreateRunner.mockImplementation(() => ({ run: api.run }) as unknown as ReturnType<typeof createAiApiOperationRunner>)
})

describe('mutation flags', () => {
  it('flags exactly the quote and catalog write tools as mutations', () => {
    const mutations = aiTools.filter((tool) => tool.isMutation === true).map((tool) => tool.name).sort()
    expect(mutations).toEqual([
      'cpq.add_bundle_component',
      'cpq.add_quote_line',
      'cpq.create_offering',
      'cpq.create_quote',
      'cpq.remove_bundle_component',
      'cpq.submit_quote_for_approval',
      'cpq.update_quote_line',
    ])
    expect([...CPQ_QUOTE_MUTATION_TOOL_NAMES, ...CPQ_CATALOG_WRITE_TOOL_NAMES].sort()).toEqual(mutations)
  })

  it('gives every mutation tool a preview resolver and no read tool one', () => {
    for (const tool of aiTools) {
      expect({ name: tool.name, hasPreview: typeof tool.loadBeforeRecord === 'function' }).toEqual({
        name: tool.name,
        hasPreview: tool.isMutation === true,
      })
    }
  })

  it.each(['', undefined])('refuses every write when approvedPendingActionId is %p', async (approved) => {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote())
    const inputs: Record<string, Record<string, unknown>> = {
      'cpq.create_quote': { customerId: CUSTOMER_ID },
      'cpq.add_quote_line': { quoteId: QUOTE_ID, offeringId: OFFERING_ID, configuration: {} },
      'cpq.update_quote_line': { quoteId: QUOTE_ID, lineId: LINE_ID, quantity: 2 },
      'cpq.submit_quote_for_approval': { quoteId: QUOTE_ID },
    }
    for (const name of CPQ_QUOTE_MUTATION_TOOL_NAMES) {
      const tool = getTool(name)
      await expect(
        tool.handler(tool.inputSchema.parse(inputs[name]), makeCtx({ approvedPendingActionId: approved })),
      ).rejects.toMatchObject({ code: 'mutation_not_approved' })
    }
    expect(api.writes()).toHaveLength(0)
  })

  it('proceeds with an approved pending action and calls the write route once', async () => {
    api.on('POST', `/cpq/quotes/${QUOTE_ID}/items`, { id: QUOTE_ID }, 201)
    const tool = getTool('cpq.add_quote_line')
    const input = tool.inputSchema.parse({ quoteId: QUOTE_ID, offeringId: OFFERING_ID, configuration: {} })
    await expect(tool.handler(input, makeCtx())).rejects.toThrow(/cannot run over MCP/)
    expect(api.writes()).toHaveLength(0)
    await expect(tool.handler(input, approvedCtx())).resolves.toEqual({ quote: { id: QUOTE_ID } })
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: 'POST', path: `/cpq/quotes/${QUOTE_ID}/items` }),
    ])
  })

  it('flags every write as destructive so it always goes through the approval card', () => {
    const writes = aiTools.filter((tool) => tool.isMutation === true)
    expect(writes.length).toBeGreaterThan(0)
    for (const tool of writes) expect(tool.isDestructive).toBe(true)
    for (const tool of aiTools.filter((candidate) => candidate.isMutation !== true)) {
      expect(tool.isDestructive).not.toBe(true)
    }
  })
})

describe('quoteRecordVersion', () => {
  it('is stable for the same state regardless of key or line order', () => {
    const a = quote()
    const b = quote({
      lines: [{ ...a.lines![0], configuration: { site: 'WAW1', bandwidth: '100M' } }],
    })
    expect(quoteRecordVersion(a)).toBe(quoteRecordVersion(b))
  })

  it.each([
    ['status', { cpqStatus: 'in_approval' }],
    ['pricing revision', { pricingRevision: 3 }],
    ['line configuration', { lines: [{ lineId: LINE_ID, configuration: { bandwidth: '1G' } }] }],
    ['line count', { lines: [] }],
  ])('changes when the %s changes', (_label, overrides) => {
    expect(quoteRecordVersion(quote(overrides as Partial<CpqQuoteSnapshot>))).not.toBe(quoteRecordVersion(quote()))
  })
})

describe('cpq.create_quote preview', () => {
  it('anchors the preview on the customer and shows the draft header', async () => {
    const tool = getTool('cpq.create_quote')
    const preview = await tool.loadBeforeRecord!({ customerId: CUSTOMER_ID, currencyCode: 'pln' }, makeCtx())
    expect(preview).toMatchObject({
      recordId: CUSTOMER_ID,
      entityType: 'customers:customer_entity',
      recordVersion: null,
      after: { quoteType: 'new', customerId: CUSTOMER_ID, currencyCode: 'PLN' },
    })
    expect(api.calls).toHaveLength(0)
  })
})

describe('cpq.add_quote_line preview', () => {
  it('reads the quote through the API and fingerprints it', async () => {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote())
    const tool = getTool('cpq.add_quote_line')
    const preview = await tool.loadBeforeRecord!(
      { quoteId: QUOTE_ID, offeringId: OFFERING_ID_2, configuration: { seats: 5 }, quantity: 5 },
      makeCtx(),
    )
    expect(api.calls).toEqual([{ method: 'GET', path: `/cpq/quotes/${QUOTE_ID}` }])
    expect(preview).toMatchObject({
      recordId: QUOTE_ID,
      entityType: 'cpq:cpq_quote_configuration',
      recordVersion: quoteRecordVersion(quote()),
      before: { lineCount: 1, newLine: null },
      after: { lineCount: 2, newLine: { offeringId: OFFERING_ID_2, quantity: 5, configuration: { seats: 5 } } },
    })
  })

  it('passes the tool itself to the runner so route features are checked against it', async () => {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote())
    const tool = getTool('cpq.add_quote_line')
    await tool.loadBeforeRecord!({ quoteId: QUOTE_ID, offeringId: OFFERING_ID, configuration: {} }, makeCtx())
    const ctxArg = mockedCreateRunner.mock.calls[0][0]
    expect(ctxArg.tool).toBe(tool)
    expect(ctxArg.tenantId).toBe(makeCtx().tenantId)
  })

  it('counts the default component lines a bundle will add', async () => {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote())
    const leaf = (id: string) => ({ offeringId: id, offeringType: 'simple', isActive: true, lifecycleStatus: 'active', isSellable: true, slots: [] })
    api.on('GET', '/cpq/bundle-tree', {
      tree: {
        offeringId: OFFERING_ID_2, offeringType: 'bundle', isActive: true,
        slots: [
          { componentGroup: 'access', cardinalityMin: 1, cardinalityMax: 1, components: [{ isDefault: true, childOffering: leaf('fiber') }] },
          { componentGroup: 'cpe', cardinalityMin: 1, cardinalityMax: 1, components: [{ isDefault: true, childOffering: leaf('ont') }] },
        ],
      },
    })
    const tool = getTool('cpq.add_quote_line')
    const preview = await tool.loadBeforeRecord!(
      { quoteId: QUOTE_ID, offeringId: OFFERING_ID_2, configuration: {}, expandBundleDefaults: true },
      makeCtx(),
    )
    expect(preview).toMatchObject({ before: { lineCount: 1 }, after: { lineCount: 4, defaultComponentLines: 2 } })
  })

  it('returns null when the quote is not visible', async () => {
    const tool = getTool('cpq.add_quote_line')
    const preview = await tool.loadBeforeRecord!({ quoteId: QUOTE_ID, offeringId: OFFERING_ID, configuration: {} }, makeCtx())
    expect(preview).toBeNull()
  })
})

describe('cpq.update_quote_line', () => {
  it('previews the merged line against the current one', async () => {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote())
    const tool = getTool('cpq.update_quote_line')
    const preview = await tool.loadBeforeRecord!(
      { quoteId: QUOTE_ID, lineId: LINE_ID, configuration: { bandwidth: '1G' } },
      makeCtx(),
    )
    expect(preview).toMatchObject({
      recordId: LINE_ID,
      entityType: 'cpq:cpq_quote_line_configuration',
      recordVersion: quoteRecordVersion(quote()),
      before: { configuration: { bandwidth: '100M', site: 'WAW1' }, quantity: 1, termMonths: 12 },
      after: { configuration: { bandwidth: '1G', site: 'WAW1' }, quantity: 1, termMonths: 12 },
    })
  })

  it('refuses to write when the line is not on the quote', async () => {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote({ lines: [] }))
    const tool = getTool('cpq.update_quote_line')
    await expect(
      tool.handler({ quoteId: QUOTE_ID, lineId: LINE_ID, quantity: 2 }, approvedCtx()),
    ).rejects.toThrow(/was not found/)
    expect(api.writes()).toHaveLength(0)
  })

  it('mergeLinePatch keeps unspecified values', () => {
    const usageEstimates = [{ chargeCode: 'egress', estimatedQuantity: 50 }]
    const merged = mergeLinePatch(
      { configuration: { a: 1, b: 2 }, quantity: 4, startDate: '2026-01-01', termMonths: 12, endDate: null, usageEstimates },
      { quoteId: QUOTE_ID, lineId: LINE_ID, configuration: { b: 3 } },
    )
    expect(merged).toEqual({ configuration: { a: 1, b: 3 }, quantity: 4, startDate: '2026-01-01', termMonths: 12, endDate: null, usageEstimates })
  })

  it('drops the stored end date when the term or start changes, so the server recomputes it', () => {
    const current = {
      configuration: {},
      quantity: 1,
      startDate: '2026-01-01',
      termMonths: 12,
      endDate: '2027-01-01',
      usageEstimates: null,
    }
    const base = { quoteId: QUOTE_ID, lineId: LINE_ID }
    expect(mergeLinePatch(current, { ...base, termMonths: 24 }).endDate).toBeNull()
    expect(mergeLinePatch(current, { ...base, startDate: '2026-03-01' }).endDate).toBeNull()
    expect(mergeLinePatch(current, { ...base, termMonths: 24, endDate: '2028-06-30' }).endDate).toBe('2028-06-30')
    expect(mergeLinePatch(current, { ...base, quantity: 3 }).endDate).toBe('2027-01-01')
  })

  it('does not send a stale end date on a term change', async () => {
    const dated = quote({
      lines: [
        { lineId: LINE_ID, offeringId: OFFERING_ID, quantity: 1, configuration: {}, startDate: '2026-01-01', termMonths: 12, endDate: '2027-01-01' },
      ],
    })
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, dated)
    api.on('PUT', `/cpq/quotes/${QUOTE_ID}/items/${LINE_ID}`, dated)
    await getTool('cpq.update_quote_line').handler({ quoteId: QUOTE_ID, lineId: LINE_ID, termMonths: 24 }, approvedCtx())
    const body = api.writes()[0].body as Record<string, unknown>
    expect(body).toMatchObject({ startDate: '2026-01-01', termMonths: 24 })
    expect(body).not.toHaveProperty('endDate')
  })

  it('sends the current usage estimates back so the PUT does not clear them', async () => {
    const withUsage = quote({
      lines: [
        {
          lineId: LINE_ID,
          offeringId: OFFERING_ID,
          quantity: 1,
          configuration: { bandwidth: '100M', site: 'WAW1' },
          termMonths: 12,
          usageEstimates: [{ chargeCode: 'egress', estimatedQuantity: 50, estimatedTotal: 25 }],
        },
      ],
    })
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, withUsage)
    api.on('PUT', `/cpq/quotes/${QUOTE_ID}/items/${LINE_ID}`, withUsage)
    await getTool('cpq.update_quote_line').handler({ quoteId: QUOTE_ID, lineId: LINE_ID, quantity: 2 }, approvedCtx())
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ quantity: 2, usageEstimates: [{ chargeCode: 'egress', estimatedQuantity: 50 }] }),
      }),
    ])
  })

  it('changes the record version when usage estimates change', () => {
    const base = quote()
    const lines = base.lines!.map((line) => ({ ...line, usageEstimates: [{ chargeCode: 'egress', estimatedQuantity: 5 }] }))
    expect(quoteRecordVersion({ ...base, lines })).not.toEqual(quoteRecordVersion(base))
  })
})

describe('cpq.submit_quote_for_approval', () => {
  it('previews the status change', async () => {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote({ cpqStatus: 'incomplete' }))
    const preview = await getTool('cpq.submit_quote_for_approval').loadBeforeRecord!({ quoteId: QUOTE_ID }, makeCtx())
    expect(preview).toMatchObject({ before: { cpqStatus: 'incomplete' }, after: { cpqStatus: 'in_approval' } })
  })

  it.each(['in_approval', 'approved', 'with_customer', 'accepted', 'rejected', 'cancelled'])(
    'refuses to submit a quote in status %s',
    async (status) => {
      api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote({ cpqStatus: status }))
      await expect(
        getTool('cpq.submit_quote_for_approval').handler({ quoteId: QUOTE_ID }, approvedCtx()),
      ).rejects.toThrow(/can be submitted for approval/)
      expect(api.writes()).toHaveLength(0)
    },
  )
})

describe('request bodies satisfy the route validators', () => {
  async function bodyOf(name: string, input: Record<string, unknown>, method: string): Promise<unknown> {
    api.on('GET', `/cpq/quotes/${QUOTE_ID}`, quote())
    api.on(method as 'POST', /.*/, {})
    const tool = getTool(name)
    await tool.handler(tool.inputSchema.parse(input), tool.isMutation ? approvedCtx() : makeCtx())
    const call = api.calls.find((entry) => entry.method === method)
    expect(call).toBeDefined()
    return call!.body
  }

  it('cpq.create_quote -> cpqCreateQuoteSchema', async () => {
    const body = await bodyOf('cpq.create_quote', { customerId: CUSTOMER_ID, dealId: OFFERING_ID }, 'POST')
    expect(cpqCreateQuoteSchema.parse(body)).toMatchObject({ customerId: CUSTOMER_ID, quoteType: 'new' })
  })

  it('cpq.add_quote_line -> cpqAddQuoteItemSchema', async () => {
    const body = await bodyOf(
      'cpq.add_quote_line',
      { quoteId: QUOTE_ID, offeringId: OFFERING_ID, configuration: { a: 1 }, parentLineId: LINE_ID, startDate: '2026-12-01' },
      'POST',
    )
    expect(cpqAddQuoteItemSchema.safeParse(body).success).toBe(true)
  })

  it('cpq.update_quote_line -> cpqUpdateQuoteItemSchema', async () => {
    const body = await bodyOf('cpq.update_quote_line', { quoteId: QUOTE_ID, lineId: LINE_ID, termMonths: 36 }, 'PUT')
    expect(cpqUpdateQuoteItemSchema.safeParse(body).success).toBe(true)
  })

  it('cpq.submit_quote_for_approval -> cpqTransitionStatusSchema', async () => {
    const body = await bodyOf('cpq.submit_quote_for_approval', { quoteId: QUOTE_ID }, 'POST')
    expect(cpqTransitionStatusSchema.parse(body)).toEqual({ targetStatus: 'in_approval' })
  })

  it('cpq.calculate_price -> cpqPricePreviewSchema (with and without a primary item)', async () => {
    const full = await bodyOf(
      'cpq.calculate_price',
      { primaryItem: { offeringId: OFFERING_ID, configuration: {} }, currencyCode: 'EUR' },
      'POST',
    )
    expect(cpqPricePreviewSchema.safeParse(full).success).toBe(true)
    api = new FakeApi()
    const childrenOnly = await bodyOf('cpq.calculate_price', { childItems: [{ offeringId: OFFERING_ID, configuration: {} }] }, 'POST')
    expect(cpqPricePreviewSchema.safeParse(childrenOnly).success).toBe(true)
  })

  it('cpq.validate_configuration -> cpqValidateRelationshipsSchema', async () => {
    const body = await bodyOf('cpq.validate_configuration', { offeringIds: [OFFERING_ID] }, 'POST')
    expect(cpqValidateRelationshipsSchema.safeParse(body).success).toBe(true)
  })
})

describe('catalog write tools (#128)', () => {
  const offeringDetail = {
    id: OFFERING_ID,
    code: 'FH',
    name: 'Fiber Home',
    offeringType: 'bundle',
    components: [{ id: LINE_ID, slot: { name: 'CPE' }, childOfferingId: OFFERING_ID_2, childOffering: { name: 'ONT' }, isDefault: true }],
  }

  it.each(['', undefined])('refuses every catalog write when approvedPendingActionId is %p', async (approved) => {
    api.on('GET', '/cpq/product-offerings', offeringDetail)
    const inputs: Record<string, Record<string, unknown>> = {
      'cpq.create_offering': { specId: SPEC_ID, code: 'ont', name: 'ONT' },
      'cpq.add_bundle_component': { offeringId: OFFERING_ID, slotId: SPEC_ID, childOfferingId: OFFERING_ID_2 },
      'cpq.remove_bundle_component': { offeringId: OFFERING_ID, componentId: LINE_ID },
    }
    for (const name of CPQ_CATALOG_WRITE_TOOL_NAMES) {
      const tool = getTool(name)
      await expect(
        tool.handler(tool.inputSchema.parse(inputs[name]), makeCtx({ approvedPendingActionId: approved })),
      ).rejects.toMatchObject({ code: 'mutation_not_approved' })
    }
    expect(api.writes()).toHaveLength(0)
  })

  it('builds request bodies the routes accept', async () => {
    api.on('POST', '/cpq/product-offerings', { id: OFFERING_ID }, 201).on('POST', '/cpq/offering-components', { id: LINE_ID }, 201)
    const create = getTool('cpq.create_offering')
    await create.handler(create.inputSchema.parse({ specId: SPEC_ID, code: 'ont', name: 'ONT', isSellable: false }), approvedCtx())
    const add = getTool('cpq.add_bundle_component')
    await add.handler(add.inputSchema.parse({ offeringId: OFFERING_ID, slotId: SPEC_ID, childOfferingId: OFFERING_ID_2 }), approvedCtx())
    const [createCall, addCall] = api.writes()
    expect(cpqProductOfferingCreateSchema.safeParse(createCall.body).success).toBe(true)
    expect(cpqOfferingComponentCreateSchema.safeParse(addCall.body).success).toBe(true)
  })

  it('previews a new offering with the spec default for isSellable', async () => {
    api.on('GET', '/cpq/product-specifications', { id: SPEC_ID, code: 'cpe', name: 'CPE', specType: 'simple', defaultOfferingSellable: false })
    const tool = getTool('cpq.create_offering')
    const preview = await tool.loadBeforeRecord!({ specId: SPEC_ID, code: 'ont', name: 'ONT' }, makeCtx())
    expect(preview).toMatchObject({
      recordId: SPEC_ID,
      before: { code: null, name: null, isSellable: null },
      after: { specification: 'CPE (cpe)', offeringType: 'simple', code: 'ont', name: 'ONT', lifecycleStatus: 'draft', isSellable: false },
    })
  })

  it('previews adding a component with the slot and offering names', async () => {
    api
      .on('GET', '/cpq/bundle-slots', { id: SPEC_ID, name: 'CPE' })
      .on('GET', '/cpq/product-offerings', offeringDetail)
    const tool = getTool('cpq.add_bundle_component')
    const preview = await tool.loadBeforeRecord!({ offeringId: OFFERING_ID, slotId: SPEC_ID, childOfferingId: OFFERING_ID_2 }, makeCtx())
    expect(preview).toMatchObject({ before: { slot: null, childOffering: null }, after: { bundle: 'Fiber Home (FH)', slot: 'CPE', isDefault: false } })
  })

  it('previews and runs a removal, and refuses a component of another bundle', async () => {
    api.on('GET', '/cpq/product-offerings', offeringDetail).on('DELETE', '/cpq/offering-components', { success: true })
    const tool = getTool('cpq.remove_bundle_component')
    const preview = await tool.loadBeforeRecord!({ offeringId: OFFERING_ID, componentId: LINE_ID }, makeCtx())
    expect(preview).toMatchObject({ before: { slot: 'CPE', childOffering: 'ONT', isDefault: true }, after: { slot: null, childOffering: null } })

    const foreign = tool.inputSchema.parse({ offeringId: OFFERING_ID, componentId: QUOTE_ID })
    await expect(tool.handler(foreign, approvedCtx())).rejects.toThrow(/was not found on bundle offering/)
    expect(api.writes()).toHaveLength(0)

    await expect(tool.handler(tool.inputSchema.parse({ offeringId: OFFERING_ID, componentId: LINE_ID }), approvedCtx()))
      .resolves.toEqual({ removed: true, componentId: LINE_ID })
    expect(api.writes()).toEqual([expect.objectContaining({ method: 'DELETE', path: '/cpq/offering-components', body: { id: LINE_ID } })])
  })
})
