import {
  DEFAULT_INVOICE_LANGUAGE,
  isSupportedInvoiceLanguage,
} from '@dainamite/billing/modules/billing/lib/invoiceLanguages'
import type { AccountOverrides } from '../data/validators'

/**
 * Pure precedence rules of the order billing setup (spec
 * `2026-11-15-cpq-billing-connector-order-billing-setup`, D3–D5). Shared by
 * the activation subscriber (what actually happens) and the order-setup API
 * (what the operator is shown), so the two can never disagree.
 */

export type BillCycle = 'monthly' | 'quarterly' | 'annually' | 'weekly'

/**
 * Amend / renew orders add lines to an existing subscription: only the bill
 * start of the added lines is set up, the account is the subscription's (D7).
 */
export function isArcQuoteType(quoteType: string): boolean {
  return quoteType === 'amend' || quoteType === 'renew'
}

/** Billing's `invoice_address` shape (strict on billing's side). */
export type BillingInvoiceAddress = {
  line1: string
  line2?: string
  city: string
  postal_code: string
  country: string
}

/** Customer defaults as they arrive on `cpq.subscription.activated` (all optional). */
export type CustomerDefaults = {
  customerId: string
  customerKind?: 'company' | 'person'
  customerName?: string
  invoiceEmail?: string
  invoiceLanguage?: string
  /** CPQ sends `postalCode`; older payloads may already use `postal_code`. */
  invoiceAddress?: Record<string, unknown>
  billCycle?: BillCycle
  billCycleAnchor?: string
  nextBillDate?: string
  taxId?: string | null
}

export type AccountSeedValues = {
  customerId: string
  customerKind?: 'company' | 'person'
  name: string
  currencyCode: string
  billCycle: BillCycle
  billCycleAnchor: string
  invoiceEmail: string
  invoiceLanguage: string
  invoiceAddress: BillingInvoiceAddress
  /** `YYYY-MM-DD`. */
  nextBillDate: string
  taxId: string | null
}

export const PLACEHOLDER_ADDRESS: BillingInvoiceAddress = {
  line1: 'TBD',
  city: 'TBD',
  postal_code: 'TBD',
  country: 'XX',
}

export function placeholderEmail(customerId: string): string {
  return `billing+${customerId}@invalid.local`
}

export function placeholderName(customerId: string): string {
  return `Customer ${customerId}`
}

/** `Date` or a date/datetime string → `YYYY-MM-DD`; anything else → null. */
export function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return null
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Billing only accepts invoice languages its document template supports.
 * An unsupported code from upstream must not fail onboarding (the persistent
 * queue would retry forever), so it falls back to billing's default.
 */
export function resolveInvoiceLanguage(raw: string | undefined): string {
  const code = (raw ?? '').trim().toLowerCase()
  return isSupportedInvoiceLanguage(code) ? code : DEFAULT_INVOICE_LANGUAGE
}

/**
 * Map an upstream address to billing's strict shape. Each required field
 * falls back to its placeholder on its own, so a partial address keeps what
 * it has. Fields billing does not store (e.g. `region`) are dropped.
 */
export function normalizeInvoiceAddress(raw: Record<string, unknown> | undefined): BillingInvoiceAddress {
  if (!raw) return { ...PLACEHOLDER_ADDRESS }
  const country = text(raw.country)?.toUpperCase()
  const address: BillingInvoiceAddress = {
    line1: text(raw.line1) ?? PLACEHOLDER_ADDRESS.line1,
    city: text(raw.city) ?? PLACEHOLDER_ADDRESS.city,
    postal_code: text(raw.postal_code) ?? text(raw.postalCode) ?? PLACEHOLDER_ADDRESS.postal_code,
    country: country && country.length >= 2 && country.length <= 3 ? country : PLACEHOLDER_ADDRESS.country,
  }
  const line2 = text(raw.line2)
  if (line2) address.line2 = line2
  return address
}

/**
 * New-account values. Precedence per field (D5): operator override →
 * customer defaults from CPQ → placeholder.
 *
 * `nextBillDate`: override → upstream → the earliest effective bill start of
 * the subscription's items (recurring items bill in advance, Billing Spec A,
 * so a delayed start must not bill the gap) → activation date → today.
 */
export function buildAccountSeedValues(input: {
  defaults: CustomerDefaults
  currencyCode: string
  overrides?: AccountOverrides | null
  earliestBillStart?: string | null
  activationDate?: string | null
}): AccountSeedValues {
  const { defaults, overrides } = input
  const o = overrides ?? {}
  const customerKind = o.customerKind ?? defaults.customerKind
  return {
    customerId: defaults.customerId,
    ...(customerKind ? { customerKind } : {}),
    name: o.name ?? text(defaults.customerName) ?? placeholderName(defaults.customerId),
    currencyCode: input.currencyCode,
    billCycle: o.billCycle ?? defaults.billCycle ?? 'monthly',
    billCycleAnchor: o.billCycleAnchor ?? defaults.billCycleAnchor ?? '1',
    invoiceEmail: o.invoiceEmail ?? text(defaults.invoiceEmail) ?? placeholderEmail(defaults.customerId),
    invoiceLanguage: o.invoiceLanguage ?? resolveInvoiceLanguage(defaults.invoiceLanguage),
    invoiceAddress: o.invoiceAddress
      ? { ...o.invoiceAddress }
      : normalizeInvoiceAddress(defaults.invoiceAddress),
    nextBillDate:
      o.nextBillDate ??
      toIsoDate(defaults.nextBillDate) ??
      input.earliestBillStart ??
      toIsoDate(input.activationDate) ??
      todayIsoDate(),
    taxId: o.taxId !== undefined ? o.taxId : (defaults.taxId ?? null),
  }
}

export type BillStartSetup = {
  defaultBillStartDate?: string | null
  lineBillStarts?: Record<string, string> | null
}

/**
 * Effective bill start of one line (D3): operator line override → the CPQ
 * line's service start → the order's default bill start → activation date.
 */
export function resolveLineBillStart(input: {
  orderLineId?: string | null
  serviceStartDate?: string | null
  setup?: BillStartSetup | null
  activationDate: string
}): string {
  const override = input.orderLineId ? input.setup?.lineBillStarts?.[input.orderLineId] : undefined
  return (
    toIsoDate(override) ??
    toIsoDate(input.serviceStartDate) ??
    toIsoDate(input.setup?.defaultBillStartDate) ??
    input.activationDate
  )
}

export function earliestIsoDate(dates: Array<string | null | undefined>): string | null {
  const valid = dates.map(toIsoDate).filter((d): d is string => d !== null)
  if (valid.length === 0) return null
  return valid.reduce((min, d) => (d < min ? d : min))
}

/** A billing account the connector may reuse for a CPQ order (D4). */
export type AccountCandidate = {
  id: string
  customerId: string
  currencyCode: string
  isActive: boolean
  deletedAt?: Date | string | null
  createdAt?: Date | string | null
}

export function isUsableAccount(
  account: AccountCandidate | null | undefined,
  target: { customerId: string; currencyCode: string },
): account is AccountCandidate {
  return (
    !!account &&
    !account.deletedAt &&
    account.isActive === true &&
    account.customerId === target.customerId &&
    account.currencyCode.toUpperCase() === target.currencyCode.toUpperCase()
  )
}

/** Without an explicit choice: the most recently created usable account, or null. */
export function pickDefaultAccount(
  accounts: AccountCandidate[],
  target: { customerId: string; currencyCode: string },
): AccountCandidate | null {
  const usable = accounts.filter((account) => isUsableAccount(account, target))
  if (usable.length === 0) return null
  const time = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : 0)
  return usable.reduce((newest, account) => (time(account.createdAt) > time(newest.createdAt) ? account : newest))
}
