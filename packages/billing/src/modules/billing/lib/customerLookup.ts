import type { CustomerKind } from '../data/validators'

/**
 * Pure helpers for linking a Billing Account to a customer record (Spec E).
 *
 * Billing never imports the customers module: `customer_id` is a string FK
 * and every read goes through the customers REST API from the UI (a soft
 * dependency — if it is unavailable the form degrades to a raw id and no
 * prefill). These helpers keep the response-shape knowledge in one tested
 * place so the React components stay thin.
 */

export type CustomerSummary = {
  id: string
  name: string
  email: string | null
}

export type PrefillAddress = {
  line1: string
  line2: string
  city: string
  postal_code: string
  country: string
}

export type PrefillTarget = {
  name: string
  invoiceEmail: string
  invoiceAddress: PrefillAddress
}

type RawRecord = Record<string, unknown>

const CUSTOMER_ENDPOINTS: Record<CustomerKind, string> = {
  company: '/api/customers/companies',
  person: '/api/customers/people',
}

const CUSTOMER_DETAIL_PATHS: Record<CustomerKind, string> = {
  company: '/backend/customers/companies',
  person: '/backend/customers/people',
}

/** Max ids per batched lookup — the CRUD factory caps `pageSize` at 100. */
export const CUSTOMER_LOOKUP_CHUNK = 100

export function customerEndpoint(kind: CustomerKind): string {
  return CUSTOMER_ENDPOINTS[kind]
}

export function customerDetailHref(kind: CustomerKind, customerId: string): string {
  return `${CUSTOMER_DETAIL_PATHS[kind]}/${encodeURIComponent(customerId)}`
}

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

/** Extracts the row array from a list response (`{ items }` or a bare array). */
export function extractItems(result: unknown): RawRecord[] {
  const raw = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)
      ? (result as { items: unknown[] }).items
      : []
  return raw.filter((row): row is RawRecord => !!row && typeof row === 'object')
}

/** Maps a customers list row (snake_case or camelCase) to a summary. */
export function toCustomerSummary(row: RawRecord): CustomerSummary | null {
  const id = str(row.id)
  if (!id) return null
  const name = str(row.display_name) || str(row.displayName) || str(row.name) || id
  const email = str(row.primary_email) || str(row.primaryEmail) || str(row.email)
  return { id, name, email: email || null }
}

/**
 * Picks the customer's primary address (else the first usable one) and maps
 * it onto the billing `invoice_address` shape. Returns null when no row has
 * the parts billing requires (line 1, city, postal code, country).
 */
export function mapPrimaryAddress(rows: RawRecord[]): PrefillAddress | null {
  const ordered = [...rows].sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true))
  for (const row of ordered) {
    const street = str(row.address_line1) || str(row.addressLine1)
    const building = str(row.building_number) || str(row.buildingNumber)
    const flat = str(row.flat_number) || str(row.flatNumber)
    let line1 = street
    if (line1 && building) line1 = `${line1} ${building}`
    if (line1 && building && flat) line1 = `${line1}/${flat}`
    const city = str(row.city)
    const postalCode = str(row.postal_code) || str(row.postalCode)
    const country = (str(row.country) || str(row.country_code) || str(row.countryCode)).toUpperCase()
    if (!line1 || !city || !postalCode || country.length < 2 || country.length > 3) continue
    return {
      line1,
      line2: str(row.address_line2) || str(row.addressLine2),
      city,
      postal_code: postalCode,
      country,
    }
  }
  return null
}

function isAddressEmpty(address: PrefillAddress): boolean {
  return !address.line1.trim() && !address.line2.trim() && !address.city.trim() && !address.postal_code.trim()
}

/**
 * Fills ONLY empty fields from the customer record (decision E2-D2) — never
 * overwrites what the operator typed. The address is taken as a whole block
 * (and only if the form's address is still blank) so we never mix a typed
 * street with a prefilled city. Country alone does not count as "typed": the
 * form ships a default country.
 */
export function applyCustomerPrefill<T extends PrefillTarget>(
  current: T,
  customer: CustomerSummary | null,
  address: PrefillAddress | null,
): T {
  let next = current
  if (customer) {
    if (!current.name.trim() && customer.name) next = { ...next, name: customer.name }
    if (!current.invoiceEmail.trim() && customer.email) next = { ...next, invoiceEmail: customer.email }
  }
  if (address && isAddressEmpty(current.invoiceAddress)) {
    next = { ...next, invoiceAddress: { ...address } }
  }
  return next
}

/** Groups ids by kind and chunks them for batched `?ids=` lookups. */
export function planCustomerLookups(
  rows: Array<{ customerId: string | null | undefined; customerKind: CustomerKind | null | undefined }>,
): Array<{ kind: CustomerKind; ids: string[] }> {
  const byKind = new Map<CustomerKind, Set<string>>()
  for (const row of rows) {
    const id = (row.customerId ?? '').trim()
    if (!id) continue
    const kind: CustomerKind = row.customerKind === 'person' ? 'person' : 'company'
    if (!byKind.has(kind)) byKind.set(kind, new Set())
    byKind.get(kind)!.add(id)
  }
  const plan: Array<{ kind: CustomerKind; ids: string[] }> = []
  for (const [kind, ids] of byKind) {
    const all = Array.from(ids)
    for (let i = 0; i < all.length; i += CUSTOMER_LOOKUP_CHUNK) {
      plan.push({ kind, ids: all.slice(i, i + CUSTOMER_LOOKUP_CHUNK) })
    }
  }
  return plan
}
