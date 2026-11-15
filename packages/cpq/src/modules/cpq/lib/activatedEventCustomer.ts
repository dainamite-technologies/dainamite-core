/**
 * Customer fields for the `cpq.subscription.activated` event payload.
 *
 * They come from the sales order's frozen snapshots (`customer_snapshot`,
 * `billing_address_snapshot`), so they describe the customer as it was when
 * the order was placed. Downstream subscribers (e.g. a billing connector)
 * use them as defaults. CPQ itself attaches no billing meaning to them.
 *
 * Every field is optional: a missing snapshot or a missing value is
 * omitted rather than guessed, so subscribers can apply their own
 * fallbacks.
 */

export type ActivatedEventAddress = {
  line1?: string
  line2?: string
  city?: string
  postalCode?: string
  region?: string
  country?: string
}

export type ActivatedEventCustomerFields = {
  customerName?: string
  customerKind?: 'company' | 'person'
  invoiceEmail?: string
  invoiceAddress?: ActivatedEventAddress
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** `addressLine1` plus building / flat numbers when the snapshot splits them out. */
function streetLine(address: Record<string, unknown>): string | undefined {
  const street = text(address.addressLine1)
  if (!street) return undefined
  const building = text(address.buildingNumber)
  const flat = text(address.flatNumber)
  const number = building ? (flat ? `${building}/${flat}` : building) : undefined
  return number && !street.includes(number) ? `${street} ${number}` : street
}

function mapAddress(raw: unknown): ActivatedEventAddress | undefined {
  const address = asRecord(raw)
  if (!address) return undefined
  const mapped: ActivatedEventAddress = {}
  const line1 = streetLine(address)
  if (line1) mapped.line1 = line1
  const line2 = text(address.addressLine2)
  if (line2) mapped.line2 = line2
  const city = text(address.city)
  if (city) mapped.city = city
  const postalCode = text(address.postalCode)
  if (postalCode) mapped.postalCode = postalCode
  const region = text(address.region)
  if (region) mapped.region = region
  const country = text(address.country)
  if (country) mapped.country = country.toUpperCase()
  return Object.keys(mapped).length > 0 ? mapped : undefined
}

export function buildActivatedEventCustomerFields(salesOrder: {
  customerSnapshot?: Record<string, unknown> | null
  billingAddressSnapshot?: Record<string, unknown> | null
} | null | undefined): ActivatedEventCustomerFields {
  const fields: ActivatedEventCustomerFields = {}
  if (!salesOrder) return fields
  const customer = asRecord(asRecord(salesOrder.customerSnapshot)?.customer)
  if (customer) {
    const name = text(customer.displayName)
    if (name) fields.customerName = name
    if (customer.kind === 'company' || customer.kind === 'person') fields.customerKind = customer.kind
    const email = text(customer.primaryEmail)
    if (email) fields.invoiceEmail = email
  }
  const address = mapAddress(salesOrder.billingAddressSnapshot)
  if (address) fields.invoiceAddress = address
  return fields
}
