import type { EntityManager } from '@mikro-orm/postgresql'
import { applySellerDefaults, type SellerProfile } from '@dainamite/billing/modules/billing/lib/seeds/sellerSettings'

/**
 * Billing seller details of the GIX demo tenant, so invoices can be posted
 * (and PDFs show a real-looking issuer) right after `yarn initialize`.
 * Fills empty fields only — safe to re-run, never overwrites edits.
 * Demo data: the IBAN and NIP are checksum-valid but fictitious.
 */
export const GIX_SELLER: SellerProfile = {
  legalName: 'GIX Network Services Sp. z o.o.',
  sellerAddress: { line1: 'ul. Łączności 8', city: 'Warszawa', postal_code: '00-695', country: 'PL' },
  taxId: 'PL5252345675',
  bankName: 'Bank Pekao S.A.',
  iban: 'PL54124010371111001234567890',
  bic: 'PKOPPLPW',
  invoiceFooter: 'GIX Network Services Sp. z o.o. — Sąd Rejonowy dla m.st. Warszawy, KRS 0000123456. Dane demonstracyjne.',
}

export async function seedGixBillingSettings(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  await applySellerDefaults(em, scope, GIX_SELLER)
}
