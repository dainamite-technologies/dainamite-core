import { billingSettingsUpdateSchema } from '@dainamite/billing/modules/billing/data/validators'
import { GIX_SELLER } from '../billing'
import { PUFFIN_SELLER } from '../../../demo_puffin/seeds/billing'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

describe('demo tenant billing sellers', () => {
  it.each([
    ['GIX', GIX_SELLER],
    ['Puffin', PUFFIN_SELLER],
  ])('%s seller passes the billing settings validators (valid IBAN / BIC / address)', (_name, profile) => {
    const result = billingSettingsUpdateSchema.safeParse({ ...scope, ...profile })
    expect(result.success ? [] : result.error.issues).toEqual([])
  })
})
