import { OrderError } from '../../services/cpqOrderService'
const addQuoteItem = jest.fn()
const updateQuoteItem = jest.fn()
const removeQuoteItem = jest.fn()
const convertQuoteToOrder = jest.fn()
const runCpqMutationGuards = jest.fn()
const runAfterSuccess = jest.fn()

jest.mock('../context', () => ({
  resolveCpqRouteContext: jest.fn().mockImplementation(async () => ({
    auth: { sub: '44444444-4444-4444-8444-444444444444' }, organizationId: 'org-1', tenantId: 'tenant-1',
    container: { resolve: () => ({ convertQuoteToOrder }) },
  })),
}))
jest.mock('../resolveQuotingService', () => ({
  resolveQuotingService: () => ({ addQuoteItem, updateQuoteItem, removeQuoteItem }),
}))
jest.mock('../_helpers/quoteMutationGuard', () => ({
  CPQ_QUOTE_RESOURCE_KIND: 'cpq.quote',
  CPQ_QUOTE_LINE_RESOURCE_KIND: 'cpq.quote_line',
  runCpqMutationGuards: (...args: unknown[]) => runCpqMutationGuards(...args),
}))

import { POST as add } from '../quotes/[quoteId]/items/route'
import { PUT as update, DELETE as remove } from '../quotes/[quoteId]/items/[lineId]/route'
import { POST as convert } from '../orders/route'

const quoteId = '11111111-1111-4111-8111-111111111111'
const lineId = '22222222-2222-4222-8222-222222222222'
const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const ACTOR = '44444444-4444-4444-8444-444444444444'
const params = { params: Promise.resolve({ quoteId, lineId }) }
function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/cpq/quotes', {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const cases = [
  { name: 'add', invoke: () => add(request('POST', { configuration: {}, quantity: 1 }), params), service: addQuoteItem, operation: 'create', resourceKind: 'cpq.quote_line', status: 201 },
  { name: 'update', invoke: () => update(request('PUT', { configuration: {}, quantity: 1 }), params), service: updateQuoteItem, operation: 'update', resourceKind: 'cpq.quote_line', status: 200 },
  { name: 'remove', invoke: () => remove(request('DELETE'), params), service: removeQuoteItem, operation: 'delete', resourceKind: 'cpq.quote_line', status: 200 },
  { name: 'convert', invoke: () => convert(request('POST', { quoteId })), service: convertQuoteToOrder, operation: 'custom', resourceKind: 'cpq.quote', status: 201 },
]

beforeEach(() => {
  jest.clearAllMocks()
  for (const entry of cases) entry.service.mockResolvedValue({ id: quoteId })
  runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
})

describe.each(cases)('$name quote write guards', ({ invoke, service, operation, resourceKind, status }) => {
  it('consults the guard before writing and invokes after-success after writing', async () => {
    expect((await invoke()).status).toBe(status)
    expect(runCpqMutationGuards).toHaveBeenCalledWith(expect.anything(), expect.any(Request),
      expect.objectContaining({ operation, resourceKind }))
    expect(service).toHaveBeenCalledTimes(1)
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(runCpqMutationGuards.mock.invocationCallOrder[0]).toBeLessThan(service.mock.invocationCallOrder[0])
    expect(service.mock.invocationCallOrder[0]).toBeLessThan(runAfterSuccess.mock.invocationCallOrder[0])
  })
  it('returns a guard rejection without writing or calling after-success', async () => {
    runCpqMutationGuards.mockResolvedValue({ ok: false, response: Response.json({ error: 'Approval required' }, { status: 423 }) })
    const response = await invoke()
    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Approval required' })
    expect(service).not.toHaveBeenCalled()
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })
  it('does not call after-success if the write fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      service.mockRejectedValueOnce(new Error('Write failed'))
      expect((await invoke()).status).toBe(500)
      expect(runAfterSuccess).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
})

it.each(cases.slice(0, 2))('$name validates and applies guard-modified fields', async ({ invoke, service, name }) => {
  runCpqMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { quantity: 3 }, runAfterSuccess })
  await invoke()
  const args = name === 'add'
    ? [quoteId, expect.objectContaining({ quantity: 3 }), scope, ACTOR]
    : [quoteId, lineId, expect.objectContaining({ quantity: 3 }), scope, ACTOR]
  expect(service).toHaveBeenCalledWith(...args)
})
it.each(cases.slice(0, 2))('$name refuses invalid guard-modified fields before writing', async ({ invoke, service }) => {
  runCpqMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { quantity: 0 }, runAfterSuccess })
  expect((await invoke()).status).toBe(400)
  expect(service).not.toHaveBeenCalled()
  expect(runAfterSuccess).not.toHaveBeenCalled()
})

it('returns the invalid adjustment line/code from conversion without running after-success', async () => {
  convertQuoteToOrder.mockRejectedValueOnce(new OrderError(422, 'ADJUSTMENT_INVALID', { lineId, code: 'ABOVE_STANDARD' }))
  const response = await convert(request('POST', { quoteId }))
  expect(response.status).toBe(422)
  expect(await response.json()).toEqual({ error: 'ADJUSTMENT_INVALID', lineId, code: 'ABOVE_STANDARD' })
  expect(runAfterSuccess).not.toHaveBeenCalled()
})
