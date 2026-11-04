/**
 * QuotingError / OrderError must be recognisable across duplicate copies of
 * their module. In a production Next build the page layer and the route layer
 * each bundle @dainamite/cpq, and the DI container is shared via globalThis,
 * so a route handler can catch an error built from the *other* copy. With
 * `instanceof` that silently turned a typed 404 into a 500.
 *
 * `jest.isolateModules` loads a second, independent copy of each module —
 * the same condition the bundler creates.
 */
import { QuotingError, isQuotingError } from '../cpqQuotingService'
import { OrderError, isOrderError } from '../cpqOrderService'

type QuotingModule = typeof import('../cpqQuotingService')
type OrderModule = typeof import('../cpqOrderService')

function loadIsolated<T>(load: () => T): T {
  let mod: T | undefined
  jest.isolateModules(() => {
    mod = load()
  })
  if (!mod) throw new Error('[internal] isolated module failed to load')
  return mod
}

describe('isQuotingError', () => {
  it('recognises an error thrown by a separate copy of the module', () => {
    const other = loadIsolated<QuotingModule>(() => require('../cpqQuotingService'))
    const err = new other.QuotingError(404, 'Quote not found')

    // The precondition the guard exists for: the class identities differ.
    expect(other.QuotingError).not.toBe(QuotingError)
    expect(err instanceof QuotingError).toBe(false)

    expect(isQuotingError(err)).toBe(true)
    if (isQuotingError(err)) expect(err.status).toBe(404)
  })

  it('accepts a same-copy error', () => {
    expect(isQuotingError(new QuotingError(409, 'conflict'))).toBe(true)
  })

  it.each([
    ['a plain Error', new Error('x')],
    ['an OrderError', new OrderError(404, 'x')],
    ['a look-alike with the same name and status', Object.assign(new Error('x'), { name: 'QuotingError', status: 404 })],
    ['null', null],
    ['a string', 'QuotingError'],
  ])('rejects %s', (_label, value) => {
    expect(isQuotingError(value)).toBe(false)
  })
})

describe('isOrderError', () => {
  it('recognises an error thrown by a separate copy of the module', () => {
    const other = loadIsolated<OrderModule>(() => require('../cpqOrderService'))
    const err = new other.OrderError(404, 'Order not found')

    expect(other.OrderError).not.toBe(OrderError)
    expect(err instanceof OrderError).toBe(false)

    expect(isOrderError(err)).toBe(true)
  })

  it.each([
    ['a plain Error', new Error('x')],
    ['a QuotingError', new QuotingError(404, 'x')],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isOrderError(value)).toBe(false)
  })
})
