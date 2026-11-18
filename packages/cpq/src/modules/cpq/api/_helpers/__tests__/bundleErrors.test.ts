import { bundleErrorResponse, isUniqueViolation } from '../bundleErrors'

describe('bundleErrorResponse', () => {
  it.each(['Offering not found', 'Slot not found', 'Child offering not found', 'Specification not found'])(
    'maps "%s" to 404',
    async (message) => {
      const response = bundleErrorResponse(new Error(message))
      expect(response?.status).toBe(404)
      expect(await response?.json()).toEqual({ error: message })
    },
  )

  it('maps V-* rule violations to 400', async () => {
    const response = bundleErrorResponse(new Error('V-COMP-2: Child offering spec must match'))
    expect(response?.status).toBe(400)
  })

  it('maps a unique-index race to 409 V-COMP-5', async () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    const response = bundleErrorResponse(err)
    expect(response?.status).toBe(409)
    expect((await response?.json()).error).toMatch(/^V-COMP-5/)
  })

  it('recognises MikroORM UniqueConstraintViolationException by name', () => {
    const err = new Error('dup')
    err.name = 'UniqueConstraintViolationException'
    expect(isUniqueViolation(err)).toBe(true)
  })

  it('returns null for unexpected errors so the route logs them and answers 500', () => {
    expect(bundleErrorResponse(new Error('connection reset'))).toBeNull()
    expect(bundleErrorResponse('boom')).toBeNull()
  })
})
