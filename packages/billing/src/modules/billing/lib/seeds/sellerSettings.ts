import type { EntityManager } from '@mikro-orm/postgresql'
import type { BillingSettings } from '../../data/entities'
import { getBillingSettings, type SettingsScope } from '../billingSettings'

/**
 * Seller details for demo / seed tenants (Spec B: posting an invoice needs
 * legal name, address, tax ID and IBAN). Public seed API — demo use cases
 * (`demo_gix`, `demo_puffin`, …) call `applySellerDefaults` from their own
 * `seedDefaults` with a profile of their own.
 *
 * Only EMPTY fields are filled, so an operator's real details are never
 * overwritten and re-running a seed is a no-op. Values must pass the settings
 * validators (checksum-valid IBAN, 8/11-char BIC) so the settings page can be
 * saved without touching them.
 */

export type SellerProfile = {
  legalName: string
  sellerAddress: { line1: string; line2?: string; city: string; postal_code: string; country: string }
  taxId: string
  bankName: string
  iban: string
  bic: string
  invoiceFooter?: string
}

const SELLER_FIELDS = ['legalName', 'sellerAddress', 'taxId', 'bankName', 'iban', 'bic', 'invoiceFooter'] as const
type SellerField = (typeof SELLER_FIELDS)[number]

/** The generic seller of the billing demo seed (primary tenant). */
export const DEFAULT_DEMO_SELLER: SellerProfile = {
  legalName: 'Dainamite Demo sp. z o.o.',
  sellerAddress: { line1: 'ul. Przykładowa 10', city: 'Kraków', postal_code: '30-001', country: 'PL' },
  taxId: 'PL1234563218',
  bankName: 'Demo Bank S.A.',
  iban: 'PL61109010140000071219812874',
  bic: 'WBKPPLPP',
  invoiceFooter: 'Sąd Rejonowy dla Krakowa-Śródmieścia, KRS 0000000000. Kapitał zakładowy 5 000 zł.',
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/** Pure: which profile values would fill which empty settings fields. */
export function sellerFieldsToFill(
  settings: Pick<BillingSettings, SellerField>,
  profile: SellerProfile,
): Partial<Record<SellerField, unknown>> {
  const out: Partial<Record<SellerField, unknown>> = {}
  for (const field of SELLER_FIELDS) {
    const value = profile[field]
    if (value === undefined) continue
    if (isEmpty(settings[field])) out[field] = value
  }
  return out
}

/**
 * Fill the organization's empty seller fields from `profile` and flush.
 * Returns the names of the fields that were filled (empty when nothing changed).
 */
export async function applySellerDefaults(
  em: EntityManager,
  scope: SettingsScope,
  profile: SellerProfile,
): Promise<string[]> {
  const settings = await getBillingSettings(em, scope)
  const fill = sellerFieldsToFill(settings, profile)
  const fields = Object.keys(fill)
  if (fields.length === 0) return []
  Object.assign(settings, fill, { updatedAt: new Date() })
  await em.flush()
  return fields
}
