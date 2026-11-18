const execute = jest.fn(), guards = jest.fn(), after = jest.fn(), enabled = jest.fn()
const service = { list: jest.fn(), get: jest.fn(), listValues: jest.fn(), importValues: jest.fn() }
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null,
  container: { resolve: (name: string) => ({ commandBus: { execute }, cpqCostService: { enabled }, cpqCostIndexService: service } as Record<string, unknown>)[name] } }
jest.mock('../../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../../_helpers/quoteMutationGuard', () => ({
  runCpqMutationGuards: (...args: unknown[]) => guards(...args),
  CPQ_COST_INDEX_RESOURCE_KIND: 'cpq.cost_index', CPQ_COST_INDEX_VALUE_RESOURCE_KIND: 'cpq.cost_index_value',
}))
import { GET as list, POST as create, metadata as listMeta, openApi as listDoc } from '../route'
import { GET as detail, PATCH, DELETE, metadata as itemMeta, openApi as itemDoc } from '../[indexId]/route'
import { GET as listValues, POST as append, metadata as valuesMeta, openApi as valuesDoc } from '../[indexId]/values/route'
import { POST as importValues, metadata as importMeta, openApi as importDoc } from '../import/route'
import { QuotingError } from '../../../services/cpqQuotingService'

const indexId = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ indexId }) }
const request = (method: string, payload?: unknown, query = '') => new Request(`http://localhost/api/cpq/cost-indices${query}`, { method, headers: { 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })
const newIndex = { code: 'BRENT', name: 'Brent', unit: 'USD/bbl', currencyCode: 'USD' }
const row = { indexCode: 'BRENT', effectiveDate: '2026-11-10', value: 82.4 }

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: { item: { id: indexId, code: 'BRENT' }, value: { id: 'v1', revision: 2 }, batchId: 'b1', results: [{ row: 1, status: 'created', revision: 1 }] }, logEntry: null })
  service.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })
  service.get.mockResolvedValue({ item: { id: indexId }, current: null, futureValueCount: 0, elements: [] })
  service.listValues.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })
  service.importValues.mockResolvedValue({ batchId: null, dryRun: true, results: [{ row: 1, indexCode: 'BRENT', effectiveDate: '2026-11-10', status: 'created', revision: 1 }] })
})

/** What the API dispatcher enforces: every feature of `requireFeatures` must be held (immutable ids, never role names). */
const allowed = (required: readonly string[], held: string[]) => required.every((feature) => held.includes(feature))
const READ_HOLDER = ['cpq.pricing.view', 'cpq.costs.view']
const WRITE_HOLDER = ['cpq.pricing.view', 'cpq.pricing.manage', 'cpq.costs.view']

describe('feature matrix', () => {
  const readers = [listMeta.GET, itemMeta.GET, valuesMeta.GET]
  const writers = [listMeta.POST, itemMeta.PATCH, itemMeta.DELETE, valuesMeta.POST, importMeta.POST]

  it('read needs pricing.view + costs.view, write needs pricing.manage + costs.view; no route relies on requireRoles', () => {
    for (const meta of readers) expect(meta).toEqual({ requireAuth: true, requireFeatures: ['cpq.pricing.view', 'cpq.costs.view'] })
    for (const meta of writers) expect(meta).toEqual({ requireAuth: true, requireFeatures: ['cpq.pricing.manage', 'cpq.costs.view'] })
    expect(JSON.stringify([listMeta, itemMeta, valuesMeta, importMeta])).not.toContain('requireRoles')
  })

  it('rep (read) reads but cannot write; admin (write) does both; a holder without costs.view / none gets neither', () => {
    expect(readers.every((meta) => allowed(meta.requireFeatures, READ_HOLDER))).toBe(true)
    expect(writers.some((meta) => allowed(meta.requireFeatures, READ_HOLDER))).toBe(false)
    expect([...readers, ...writers].every((meta) => allowed(meta.requireFeatures, WRITE_HOLDER))).toBe(true)
    for (const held of [['cpq.pricing.view', 'cpq.pricing.manage'], []]) {
      expect([...readers, ...writers].some((meta) => allowed(meta.requireFeatures, held))).toBe(false)
    }
  })
})

describe('toggle off', () => {
  it('answers 404 on every route and touches no service, guard or command', async () => {
    enabled.mockResolvedValue(false)
    const responses = await Promise.all([
      list(request('GET')), create(request('POST', newIndex)), detail(request('GET'), params), PATCH(request('PATCH', { name: 'x' }), params),
      DELETE(request('DELETE'), params), listValues(request('GET'), params), append(request('POST', { effectiveDate: '2026-11-10', value: 1 }), params),
      importValues(request('POST', { items: [row] })), importValues(request('POST', { items: [row], dryRun: true })),
    ])
    expect(responses.map((response) => response.status)).toEqual(Array(9).fill(404))
    for (const fn of [execute, guards, service.list, service.get, service.listValues, service.importValues]) expect(fn).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  it('list parses the query (pageSize <= 100) and scopes by tenant / organization', async () => {
    expect((await list(request('GET', undefined, '?page=2&pageSize=20&search=br&isActive=true&sortField=name&sortDir=desc'))).status).toBe(200)
    expect(service.list).toHaveBeenCalledWith({ organizationId: 'org', tenantId: 'tenant' }, { page: 2, pageSize: 20, search: 'br', isActive: true, sortField: 'name', sortDir: 'desc' })
    expect((await list(request('GET', undefined, '?pageSize=101'))).status).toBe(400)
  })

  it('detail and values: 404 from the service is a 404, a bad id is a 400', async () => {
    service.get.mockRejectedValue(new QuotingError(404, 'Cost index not found'))
    expect((await detail(request('GET'), params)).status).toBe(404)
    expect((await detail(request('GET'), { params: Promise.resolve({ indexId: 'nope' }) })).status).toBe(400)
    await listValues(request('GET', undefined, '?from=2026-01-01&to=2026-12-31&includeSuperseded=true'), params)
    expect(service.listValues).toHaveBeenCalledWith(indexId, { organizationId: 'org', tenantId: 'tenant' }, { page: 1, pageSize: 50, from: '2026-01-01', to: '2026-12-31', includeSuperseded: true })
  })
})

describe('writes go through the guards and the command bus', () => {
  it('POST create: 201 with the item, guard first, after-success once', async () => {
    const response = await create(request('POST', newIndex))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ item: { id: indexId, code: 'BRENT' } })
    expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({ resourceKind: 'cpq.cost_index', operation: 'create' }))
    expect(execute).toHaveBeenCalledWith('cpq.cost_index.create', expect.objectContaining({ input: { index: newIndex } }))
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('PATCH / DELETE build the command inputs from the path id', async () => {
    await PATCH(request('PATCH', { isActive: false }), params)
    expect(execute.mock.calls[0]).toEqual(['cpq.cost_index.update', expect.objectContaining({ input: { indexId, patch: { isActive: false } } })])
    const deleted = await DELETE(request('DELETE'), params)
    expect(execute.mock.calls[1]).toEqual(['cpq.cost_index.delete', expect.objectContaining({ input: { indexId } })])
    expect(await deleted.json()).toEqual({ success: true })
  })

  it('POST value: 201 with the revision', async () => {
    const response = await append(request('POST', { effectiveDate: '2026-11-10', value: 82.4, sourceNote: 'ICE' }), params)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ value: { id: 'v1', revision: 2 } })
    expect(execute).toHaveBeenCalledWith('cpq.cost_index_value.append', expect.objectContaining({ input: { indexId, value: { effectiveDate: '2026-11-10', value: 82.4, sourceNote: 'ICE' } } }))
  })

  it('a guard rejection stops before the command', async () => {
    guards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
    expect((await create(request('POST', newIndex))).status).toBe(423)
    expect(execute).not.toHaveBeenCalled()
  })

  it('validation: 400 for a bad code, currency, non-positive value or date; nothing reaches guards or command', async () => {
    const bad = await Promise.all([
      create(request('POST', { ...newIndex, code: 'brent' })), create(request('POST', { ...newIndex, currencyCode: 'usd' })),
      append(request('POST', { effectiveDate: '2026-11-10', value: 0 }), params), append(request('POST', { effectiveDate: '2026-11-10', value: -5 }), params),
      append(request('POST', { effectiveDate: '10.11.2026', value: 1 }), params), PATCH(request('PATCH', { bogus: 1 }), params),
      importValues(request('POST', { items: [] })),
    ])
    expect(bad.map((response) => response.status)).toEqual(Array(7).fill(400))
    expect(guards).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    [422, 'DUPLICATE_CODE'], [422, 'UNKNOWN_CURRENCY'], [422, 'CODE_IMMUTABLE'], [422, 'INDEX_CURRENCY_LOCKED'], [422, 'INDEX_INACTIVE'], [409, 'CONCURRENT_INDEX_WRITE'], [404, 'Cost index not found'],
  ])('%i %s keeps its status and code and skips after-success', async (status, message) => {
    execute.mockRejectedValue(new QuotingError(status, message))
    const response = await PATCH(request('PATCH', { name: 'x' }), params)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: message })
    expect(after).not.toHaveBeenCalled()
  })

  it('INDEX_IN_USE lists the referencing elements', async () => {
    const elements = [{ id: 'e1', code: 'fuel_surcharge', chargeCode: 'transit', isActive: true }]
    execute.mockRejectedValue(new QuotingError(422, 'INDEX_IN_USE', undefined, { elements }))
    for (const response of [await PATCH(request('PATCH', { isActive: false }), params), await DELETE(request('DELETE'), params)]) {
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'INDEX_IN_USE', elements })
    }
  })
})

describe('import', () => {
  it('a real import is one append command and returns the batch id and per-row results', async () => {
    const response = await importValues(request('POST', { items: [row] }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ batchId: 'b1', dryRun: false, results: [{ row: 1, status: 'created', revision: 1 }] })
    expect(execute).toHaveBeenCalledWith('cpq.cost_index_value.append', expect.objectContaining({ input: { import: { items: [row] } } }))
    expect(guards).toHaveBeenCalledWith(ctx, expect.any(Request), expect.objectContaining({ resourceKind: 'cpq.cost_index_value', operation: 'create' }))
    expect(service.importValues).not.toHaveBeenCalled()
  })

  it('dry run answers from the service without a command, a guard or a write', async () => {
    const response = await importValues(request('POST', { items: [row], dryRun: true }))
    expect(response.status).toBe(200)
    expect((await response.json()).batchId).toBeNull()
    expect(service.importValues).toHaveBeenCalledWith([row], { organizationId: 'org', tenantId: 'tenant' }, { dryRun: true })
    expect(execute).not.toHaveBeenCalled()
    expect(guards).not.toHaveBeenCalled()
  })

  it('idempotent re-run: the second feed reports every row unchanged', async () => {
    execute.mockResolvedValueOnce({ result: { batchId: 'b1', results: [{ row: 1, status: 'created', revision: 1 }] } })
    execute.mockResolvedValueOnce({ result: { batchId: 'b2', results: [{ row: 1, status: 'unchanged', revision: 1 }] } })
    const first = await (await importValues(request('POST', { items: [row] }))).json()
    const second = await (await importValues(request('POST', { items: [row] }))).json()
    expect(first.results[0]).toMatchObject({ status: 'created', revision: 1 })
    expect(second.results[0]).toMatchObject({ status: 'unchanged', revision: 1 })
  })

  it('422 carries the per-row errors; 409 is retryable', async () => {
    const errors = [{ row: 2, code: 'UNKNOWN_INDEX', indexCode: 'NOPE' }]
    execute.mockRejectedValueOnce(new QuotingError(422, 'IMPORT_VALIDATION_FAILED', undefined, { errors }))
    const refused = await importValues(request('POST', { items: [row] }))
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({ error: 'IMPORT_VALIDATION_FAILED', errors })
    execute.mockRejectedValueOnce(new QuotingError(409, 'CONCURRENT_INDEX_WRITE'))
    expect((await importValues(request('POST', { items: [row] }))).status).toBe(409)
    service.importValues.mockRejectedValueOnce(new QuotingError(422, 'IMPORT_VALIDATION_FAILED', undefined, { errors }))
    expect((await importValues(request('POST', { items: [row], dryRun: true }))).status).toBe(422)
  })

  it('a row cap of 1000 applies to the envelope', async () => {
    expect((await importValues(request('POST', { items: Array.from({ length: 1001 }, () => row) }))).status).toBe(400)
  })
})

it('every route exports openApi with the CPQ cost indices tag', () => {
  for (const doc of [listDoc, itemDoc, valuesDoc, importDoc]) {
    expect(doc.tag).toBe('CPQ cost indices')
    for (const method of Object.values(doc.methods ?? {})) expect(method?.errors?.some((error) => error.status === 404)).toBe(true)
  }
})
