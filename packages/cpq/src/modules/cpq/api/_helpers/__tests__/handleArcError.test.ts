import { z } from 'zod'
import { OptimisticLockError } from '@mikro-orm/core'
import { handleArcError } from '../handleArcError'
import { QuotingError } from '../../../services/cpqQuotingService'

/**
 * Unit tests for the shared ARC error handler. Each branch of the matcher
 * pyramid gets a representative input + asserts on the resulting status code
 * and body shape.
 */

async function readBody(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('handleArcError', () => {
  it('400 + details on a Zod validation error', async () => {
    const schema = z.object({ x: z.string() })
    const parse = schema.safeParse({ x: 1 })
    expect(parse.success).toBe(false)
    const err = !parse.success ? parse.error : new Error('unreachable')

    const res = handleArcError(err, 'test')
    expect(res.status).toBe(400)
    const body = await readBody(res)
    expect(body.error).toBe('Validation error')
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('propagates QuotingError status + message + cpqStatus', async () => {
    const err = new QuotingError(409, 'Type immutable', 'in_approval')
    const res = handleArcError(err, 'test')
    expect(res.status).toBe(409)
    const body = await readBody(res)
    expect(body.error).toBe('Type immutable')
    expect(body.cpqStatus).toBe('in_approval')
  })

  it('translates OptimisticLockError to 409 "Concurrent modification detected"', async () => {
    const err = OptimisticLockError.lockFailedVersionMismatch(
      { id: 'sub-1' } as never,
      1,
      2,
    )
    const res = handleArcError(err, 'test')
    expect(res.status).toBe(409)
    const body = await readBody(res)
    expect(body.error).toBe('Concurrent modification detected')
    expect(typeof body.details).toBe('string')
  })

  it('matches OptimisticLockError via constructor name (Turbopack drift fallback)', async () => {
    // Synthesize an object whose class is locally-defined but shares the
    // canonical name. Mirrors what hot-reload produces at runtime.
    class OptimisticLockError {
      constructor(public message: string) {}
    }
    const err = new OptimisticLockError('synthetic mismatch')
    const res = handleArcError(err, 'test')
    expect(res.status).toBe(409)
    const body = await readBody(res)
    expect(body.error).toBe('Concurrent modification detected')
  })

  it('propagates inventory-service plain {status, error} throw shape', async () => {
    const err = { status: 404, error: 'Subscription not found' }
    const res = handleArcError(err, 'test')
    expect(res.status).toBe(404)
    const body = await readBody(res)
    expect(body.error).toBe('Subscription not found')
  })

  it('matches duck-typed QuotingError (Turbopack instanceof drift)', async () => {
    const err = { name: 'QuotingError', status: 409, message: 'something conflicting' }
    const res = handleArcError(err, 'test')
    expect(res.status).toBe(409)
    const body = await readBody(res)
    expect(body.error).toBe('something conflicting')
  })

  it('propagates `details` from duck-typed QuotingError into response body', async () => {
    const err = {
      name: 'QuotingError',
      status: 409,
      message: 'Subscription has another ARC quote in progress',
      details: { existingQuoteId: 'q-existing-123' },
    }
    const res = handleArcError(err, 'test')
    expect(res.status).toBe(409)
    const body = await readBody(res)
    expect(body.error).toBe('Subscription has another ARC quote in progress')
    expect(body.existingQuoteId).toBe('q-existing-123')
  })

  it('propagates `details` from typed QuotingError into response body', async () => {
    const err = new QuotingError(409, 'Conflict', undefined)
    err.details = { existingQuoteId: 'q-existing-typed' }
    const res = handleArcError(err, 'test')
    expect(res.status).toBe(409)
    const body = await readBody(res)
    expect(body.existingQuoteId).toBe('q-existing-typed')
  })

  it('falls back to 500 + logs for unexpected errors', async () => {
    const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = new Error('something internal')
      const res = handleArcError(err, 'test/ctx')
      expect(res.status).toBe(500)
      const body = await readBody(res)
      expect(body.error).toBe('Internal error')
      expect(consoleErr).toHaveBeenCalledWith('[test/ctx]', err)
    } finally {
      consoleErr.mockRestore()
    }
  })
})
