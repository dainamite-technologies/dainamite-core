import {
  BILLING_SETTINGS_DEFAULTS,
  buildSellerSnapshot,
  getBillingSettings,
  missingSellerFields,
  numberMaskFor,
  serializeBillingSettings,
  taxRateColumn,
} from '../../lib/billingSettings'
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

describe('billingSettings — Spec B seller fields', () => {
  const complete = settingsRow({
    legalName: 'Seller',
    sellerAddress: { line1: 'ul. A 1', city: 'Kraków', postal_code: '30-001', country: 'PL' },
    taxId: 'PL1',
    iban: 'PL61109010140000071219812874',
  })

  it('reports no missing fields when the printable minimum is filled', () => {
    expect(missingSellerFields(complete)).toEqual([])
  })

  it('reports empty, blank and missing fields in a stable order', () => {
    expect(missingSellerFields(settingsRow())).toEqual(['legalName', 'sellerAddress', 'taxId', 'iban'])
    expect(missingSellerFields({ ...complete, taxId: '  ', sellerAddress: {} } as BillingSettings)).toEqual([
      'sellerAddress',
      'taxId',
    ])
  })

  it('freezes the seller block for the invoice snapshot', () => {
    expect(buildSellerSnapshot(complete)).toMatchObject({
      organization_id: 'o',
      legal_name: 'Seller',
      tax_id: 'PL1',
      iban: 'PL61109010140000071219812874',
      bic: null,
      logo_attachment_id: null,
    })
  })

  it('formats VAT rates for the numeric(7,4) column', () => {
    expect(taxRateColumn(23)).toBe('23')
    expect(taxRateColumn(5.5)).toBe('5.5')
    expect(taxRateColumn(8.123456)).toBe('8.1235')
  })

  it('serializes seller fields with defaults for the settings page', () => {
    expect(serializeBillingSettings(complete)).toMatchObject({
      legalName: 'Seller',
      bic: '',
      defaultPaymentTermsDays: 14,
      defaultTaxRate: 23,
    })
  })
})

