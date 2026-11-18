import { DEFAULT_DEMO_SELLER, applySellerDefaults, sellerFieldsToFill } from '../../lib/seeds/sellerSettings'
import { billingSettingsUpdateSchema } from '../../data/validators'
import { missingSellerFields } from '../../lib/billingSettings'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

describe('seller defaults for seed tenants', () => {
  it('fills only empty fields — real details are never overwritten', () => {
    const fill = sellerFieldsToFill(
      { legalName: 'Real Co', sellerAddress: null, taxId: '', bankName: null, iban: 'PL61109010140000071219812874', bic: null, invoiceFooter: null } as never,
      DEFAULT_DEMO_SELLER,
    )
    expect(Object.keys(fill).sort()).toEqual(['bankName', 'bic', 'invoiceFooter', 'sellerAddress', 'taxId'])
  })

  it('applies and flushes once; a re-run is a no-op', async () => {
    const settings: Record<string, unknown> = { legalName: null, sellerAddress: null, taxId: null, bankName: null, iban: null, bic: null, invoiceFooter: null }
    const em = { findOne: jest.fn(async () => settings), flush: jest.fn(async () => undefined), execute: jest.fn() }
    expect(await applySellerDefaults(em as never, scope, DEFAULT_DEMO_SELLER)).toHaveLength(7)
    expect(missingSellerFields(settings as never)).toEqual([])
    expect(await applySellerDefaults(em as never, scope, DEFAULT_DEMO_SELLER)).toEqual([])
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('the default profile passes the settings validators (the page can save it unchanged)', () => {
    expect(billingSettingsUpdateSchema.safeParse({ ...scope, ...DEFAULT_DEMO_SELLER }).success).toBe(true)
  })
})
