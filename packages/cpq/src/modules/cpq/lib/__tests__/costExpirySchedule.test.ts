import { buildCostExpiryRegistration, costExpiryScheduleId, registerCostExpirySchedule } from '../costExpirySchedule'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

/** Mirrors `SchedulerService.register` upsert semantics: `isEnabled` only changes when the registration carries the key. */
function fakeScheduler() {
  const rows = new Map<string, { isEnabled: boolean; name: string }>()
  const register = jest.fn(async (registration: { id: string; name: string; isEnabled?: boolean }) => {
    const existing = rows.get(registration.id)
    rows.set(registration.id, {
      name: registration.name,
      isEnabled: registration.isEnabled !== undefined ? registration.isEnabled : (existing?.isEnabled ?? true),
    })
  })
  return { rows, register }
}
const containerWith = (scheduler?: { register: unknown }) => ({
  hasRegistration: (name: string) => name === 'schedulerService' && !!scheduler,
  resolve: <T,>() => scheduler as T,
})

describe('cost expiry schedule', () => {
  it('has a stable id per tenant and organization', () => {
    expect(costExpiryScheduleId(scope)).toBe(costExpiryScheduleId({ ...scope }))
    expect(costExpiryScheduleId(scope)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(costExpiryScheduleId(scope)).not.toBe(costExpiryScheduleId({ ...scope, organizationId: 'org-2' }))
  })

  it('is a module-owned organization queue schedule on cpq-cost-expiry, daily at 06:00 UTC', () => {
    expect(buildCostExpiryRegistration(scope)).toMatchObject({
      scopeType: 'organization', tenantId: 'tenant-1', organizationId: 'org-1', scheduleType: 'cron', scheduleValue: '0 6 * * *', timezone: 'UTC',
      targetType: 'queue', targetQueue: 'cpq-cost-expiry', sourceType: 'module', sourceModule: 'cpq',
    })
  })

  it('does not register without a schedulerService', async () => {
    expect(await registerCostExpirySchedule(containerWith(undefined), scope)).toBe(false)
  })

  it('has no isEnabled key, so a schedule an admin disabled stays disabled after re-seeding', async () => {
    expect(buildCostExpiryRegistration(scope)).not.toHaveProperty('isEnabled')
    const scheduler = fakeScheduler()
    const container = containerWith(scheduler)
    expect(await registerCostExpirySchedule(container, scope)).toBe(true)
    const id = costExpiryScheduleId(scope)
    expect(scheduler.rows.get(id)?.isEnabled).toBe(true)
    scheduler.rows.get(id)!.isEnabled = false // admin disables it on the scheduler page
    await registerCostExpirySchedule(container, scope)
    expect(scheduler.rows.size).toBe(1)
    expect(scheduler.rows.get(id)?.isEnabled).toBe(false)
  })
})
