import handler, { metadata } from '../sales-quote-deleted-cancel-requests'

const ids = { tenantId: 't-1', organizationId: 'org-1' }

function ctxWith(cancelRequestsForSalesQuote: jest.Mock) {
  return { resolve: jest.fn((name: string) => {
    if (name !== 'cpqCostSourcingService') throw new Error(`unexpected ${name}`)
    return { cancelRequestsForSalesQuote }
  }) as never }
}

describe('sales.quote.deleted subscriber (Q7)', () => {
  it('is a persistent subscriber of sales.quote.deleted', () => {
    expect(metadata).toEqual({ event: 'sales.quote.deleted', persistent: true, id: 'cpq-sales-quote-deleted-cancel-requests' })
  })

  it('cancels the requests of the deleted sales quote in the payload scope', async () => {
    const cancel = jest.fn().mockResolvedValue(2)
    await handler({ id: 'sales-1', userId: 'u1', ...ids } as never, ctxWith(cancel))
    expect(cancel).toHaveBeenCalledWith('sales-1', ids)
  })

  it('ignores a payload without id or scope', async () => {
    const cancel = jest.fn()
    await handler({ ...ids } as never, ctxWith(cancel))
    await handler({ id: 'sales-1', tenantId: 't-1' } as never, ctxWith(cancel))
    expect(cancel).not.toHaveBeenCalled()
  })

  it('logs and rethrows a failure so the persistent queue retries', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const cancel = jest.fn().mockRejectedValue(new Error('lock timeout'))
    await expect(handler({ id: 'sales-1', ...ids } as never, ctxWith(cancel))).rejects.toThrow('lock timeout')
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('sales-1'), expect.any(Error))
    errors.mockRestore()
  })
})
