import { COST_PLUS_PRICING_AVAILABLE, CpqCostService } from '../costService'

function service(enabled: boolean) {
  return new CpqCostService({ em: {} as never, featureTogglesService: { getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: enabled }) } })
}

describe('CpqCostService.assertCostPlusChargeWritable', () => {
  it('refuses with 422 COST_PLUS_DISABLED when the tenant toggle is off', async () => {
    await expect(service(false).assertCostPlusChargeWritable('tenant')).rejects.toMatchObject({ status: 422, message: 'COST_PLUS_DISABLED' })
  })

  it('refuses with 422 COST_PLUS_NOT_AVAILABLE until the engine can price cost-plus charges', async () => {
    expect(COST_PLUS_PRICING_AVAILABLE).toBe(false)
    await expect(service(true).assertCostPlusChargeWritable('tenant')).rejects.toMatchObject({ status: 422, message: 'COST_PLUS_NOT_AVAILABLE' })
  })
})
