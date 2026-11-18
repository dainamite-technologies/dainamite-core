import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * Spec B: posting needs the seller details (legal name, address, tax id,
 * IBAN). Integration tests fill them for the test organization before
 * posting. Idempotent — a PUT of the same values.
 */
export async function ensureSellerSettings(request: APIRequestContext, token: string): Promise<void> {
  const res = await apiRequest(request, 'PUT', '/api/billing/settings', {
    token,
    data: {
      legalName: 'QA Seller sp. z o.o.',
      sellerAddress: { line1: 'ul. Testowa 10', city: 'Kraków', postal_code: '30-001', country: 'PL' },
      taxId: 'PL1234563218',
      bankName: 'QA Bank',
      iban: 'PL61109010140000071219812874',
      bic: 'WBKPPLPP',
      defaultPaymentTermsDays: 14,
      defaultTaxRate: 23,
    },
  })
  expect(res.ok(), `PUT settings status was ${res.status()}`).toBeTruthy()
}
