import handle, { metadata } from '../cost-expiry.worker'

const service = () => ({ run: jest.fn(async () => ({ inserted: 2, reEmitted: 0 })) })
const ctxFor = (svc: unknown) => ({ resolve: (<T,>(name: string): T => { if (name === 'cpqCostExpiryService' && svc) return svc as T; throw new Error(`unresolved ${name}`) }) })

describe('cpq-cost-expiry worker', () => {
  beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => undefined); jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterEach(() => jest.restoreAllMocks())

  it('declares the queue, id and concurrency 1, and is not scheduler-safe', () => {
    expect(metadata).toEqual({ queue: 'cpq-cost-expiry', id: 'cpq:cost-expiry', concurrency: 1 })
    expect(metadata).not.toHaveProperty('schedulerSafe')
  })

  it('runs the scan with the envelope scope and ignores scope-shaped payload data', async () => {
    const svc = service()
    await handle({ id: 'j1', payload: { tenantId: 't1', organizationId: 'o1', scope: { tenantId: 'evil', organizationId: 'evil' }, payload: { tenantId: 'evil2' } } }, ctxFor(svc))
    expect(svc.run).toHaveBeenCalledTimes(1)
    const input = (svc.run.mock.calls[0] as unknown as [{ scope: unknown; today: string; dryRun?: boolean }])[0]
    expect(input.scope).toEqual({ tenantId: 't1', organizationId: 'o1' })
    expect(input.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(input.dryRun).toBeUndefined()
  })

  it('skips a job without an envelope scope, even when the payload carries a scope', async () => {
    const svc = service()
    await handle({ id: 'j2', payload: { tenantId: null, organizationId: 'o1', scope: { tenantId: 't1', organizationId: 'o1' } } }, ctxFor(svc))
    await handle({ id: 'j3', payload: null }, ctxFor(svc))
    expect(svc.run).not.toHaveBeenCalled()
  })

  it('degrades (no throw) when the service is not available', async () => {
    await expect(handle({ id: 'j4', payload: { tenantId: 't1', organizationId: 'o1' } }, ctxFor(null))).resolves.toBeUndefined()
  })
})
