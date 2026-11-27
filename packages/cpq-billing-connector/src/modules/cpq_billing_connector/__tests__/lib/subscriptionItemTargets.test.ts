import { isSubscriptionTerminated, resolveBillingItemKeys } from '../../lib/subscriptionItemTargets'

const scope = { tenantId: 't', organizationId: 'o' }
const containerWith = (service: unknown) =>
  ({
    resolve: (name: string) => {
      if (name !== 'cpqInventoryService' || !service) throw new Error(`not registered: ${name}`)
      return service
    },
  }) as never

describe('subscriptionItemTargets', () => {
  it('adds the assets attached to each affected item (device charges follow the item)', async () => {
    const listAssets = jest.fn(async (filters: { subscriptionItemId?: string }) => ({
      items: filters.subscriptionItemId === 'si-1' ? [{ id: 'asset-1' }] : [],
      totalPages: 1,
    }))
    const keys = await resolveBillingItemKeys(containerWith({ listAssets }), scope, 'sub-1', ['si-1', 'si-2'])
    expect(keys).toEqual(['si-1', 'si-2', 'asset-1'])
    expect(listAssets).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'sub-1', subscriptionItemId: 'si-1' }), scope)
  })

  it('falls back to the event item ids when CPQ is not resolvable or fails', async () => {
    expect(await resolveBillingItemKeys(containerWith(null), scope, 'sub-1', ['si-1'])).toEqual(['si-1'])
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = { listAssets: jest.fn().mockRejectedValue(new Error('boom')) }
    expect(await resolveBillingItemKeys(containerWith(failing), scope, 'sub-1', ['si-1'])).toEqual(['si-1'])
    warn.mockRestore()
  })

  it('reports whether the whole subscription is terminated (null when unknown)', async () => {
    const getSubscription = jest.fn().mockResolvedValueOnce({ status: 'terminated' }).mockResolvedValueOnce({ status: 'active' })
    const container = containerWith({ getSubscription })
    expect(await isSubscriptionTerminated(container, scope, 'sub-1')).toBe(true)
    expect(await isSubscriptionTerminated(container, scope, 'sub-1')).toBe(false)
    expect(await isSubscriptionTerminated(containerWith(null), scope, 'sub-1')).toBeNull()
  })
})
