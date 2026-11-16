import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandErrorResponse } from '../commandContext'

describe('commandErrorResponse', () => {
  it('maps a command interceptor rejection to its status and body', async () => {
    const err = new CommandInterceptorError("Cannot delete a quote in 'accepted' status", {
      status: 409,
      body: { error: "Cannot delete a quote in 'accepted' status" },
    })
    const response = commandErrorResponse(err)
    expect(response?.status).toBe(409)
    expect(await response!.json()).toEqual({ error: "Cannot delete a quote in 'accepted' status" })
  })

  it('maps a CRUD HTTP error', () => {
    expect(commandErrorResponse(new CrudHttpError(403, { error: 'Forbidden' }))?.status).toBe(403)
  })

  it('returns null for anything else', () => {
    expect(commandErrorResponse(new Error('boom'))).toBeNull()
  })
})
