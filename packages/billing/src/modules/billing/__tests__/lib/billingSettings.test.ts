import { BILLING_SETTINGS_DEFAULTS, getBillingSettings, numberMaskFor, serializeBillingSettings } from '../../lib/billingSettings'
import { DEFAULT_NUMBER_MASKS } from '../../lib/numbering'
import type { BillingSettings } from '../../data/entities'

const scope = { tenantId: 't', organizationId: 'o' }

function settingsRow(overrides: Partial<BillingSettings> = {}): BillingSettings {
  return {
    id: 's-1',
    tenantId: 't',
    organizationId: 'o',
    lowBalanceThresholdDefault: '5.0000',
    nearLimitBufferDefault: '0',
    statementEnabled: true,
    topupTaxRate: '23.0000',
    topupProvider: 'stripe',
    numberMasks: null,
    ...overrides,
  } as BillingSettings
}

describe('billingSettings', () => {
  it('returns the existing row without inserting', async () => {
    const row = settingsRow()
    const em = { findOne: jest.fn(async () => row), execute: jest.fn() }
    expect(await getBillingSettings(em as never, scope)).toBe(row)
    expect(em.execute).not.toHaveBeenCalled()
  })

  it('lazily creates the row with defaults (race-safe upsert) and re-reads it', async () => {
    const row = settingsRow()
    const findOne = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row)
    const execute = jest.fn(async () => [])
    expect(await getBillingSettings({ findOne, execute } as never, scope)).toBe(row)
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/ON CONFLICT \(tenant_id, organization_id\) WHERE deleted_at IS NULL DO NOTHING/)
    expect(params[7]).toBe(JSON.stringify(BILLING_SETTINGS_DEFAULTS.numberMasks))
  })

  it('falls back to default masks and serializes numbers', () => {
    const row = settingsRow({ numberMasks: { invoice: 'FV/{SEQUENCE_NUM}', receipt: 'broken' } })
    expect(numberMaskFor(row, 'invoice')).toBe('FV/{SEQUENCE_NUM}')
    expect(serializeBillingSettings(row)).toMatchObject({
      lowBalanceThresholdDefault: 5,
      topupTaxRate: 23,
      numberMasks: {
        invoice: 'FV/{SEQUENCE_NUM}',
        credit_memo: DEFAULT_NUMBER_MASKS.credit_memo,
        receipt: DEFAULT_NUMBER_MASKS.receipt,
      },
    })
  })
})
