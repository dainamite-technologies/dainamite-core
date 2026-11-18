import type { EntityManager } from '@mikro-orm/postgresql'
import { applySellerDefaults, type SellerProfile } from '@dainamite/billing/modules/billing/lib/seeds/sellerSettings'

/**
 * Billing seller details of the Puffin Cloud demo tenant, so invoices can be
 * posted (and PDFs show a real-looking issuer) right after `yarn initialize`.
 * Fills empty fields only — safe to re-run, never overwrites edits.
 * Demo data: the IBAN and NIP are checksum-valid but fictitious.
 */
export const PUFFIN_SELLER: SellerProfile = {
  legalName: 'Puffin Cloud Sp. z o.o.',
  sellerAddress: { line1: 'al. Grunwaldzka 472', city: 'Gdańsk', postal_code: '80-309', country: 'PL' },
  taxId: 'PL5841234561',
  bankName: 'ING Bank Śląski S.A.',
  iban: 'PL02105014451000009876543210',
  bic: 'INGBPLPW',
  invoiceFooter: 'Puffin Cloud Sp. z o.o. — Sąd Rejonowy Gdańsk-Północ, KRS 0000654321. Dane demonstracyjne.',
}

export async function seedPuffinBillingSettings(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  await applySellerDefaults(em, scope, PUFFIN_SELLER)
}
