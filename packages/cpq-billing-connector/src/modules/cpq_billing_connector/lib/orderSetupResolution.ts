import {
  DEFAULT_INVOICE_LANGUAGE,
  isSupportedInvoiceLanguage,
} from '@dainamite/billing/modules/billing/lib/invoiceLanguages'
import {
  BILL_CYCLES,
  DEFAULT_BILL_CYCLE,
  DEFAULT_BILL_CYCLE_INTERVAL,
  defaultCycleDay,
  normalizeCycleDay,
  validateCycleSpec,
  type BillCycle,
  type CycleSpec,
} from '@dainamite/billing/modules/billing/lib/billCycle'
import type { AccountOverrides } from '../data/validators'

/**
 * Pure precedence rules of the order billing setup (spec
 * `2026-11-15-cpq-billing-connector-order-billing-setup`, D3–D5). Shared by
 * the activation subscriber (what actually happens) and the order-setup API
 * (what the operator is shown), so the two can never disagree.
 */

export type { BillCycle, CycleSpec }

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
  /** 'quarterly' (pre-0.23 payloads) is read as monthly × 3. */
  billCycle?: BillCycle | 'quarterly'
  billCycleInterval?: number
  /** '1'–'31' (monthly / annually) | 'mon'–'sun' (weekly) | null (daily). */
  billCycleDay?: string | number | null
  nextBillDate?: string
  taxId?: string | null
}

export type AccountSeedValues = {
  customerId: string
  customerKind?: 'company' | 'person'
  name: string
  currencyCode: string
  billCycle: BillCycle
  billCycleInterval: number
  billCycleDay: string | null
  invoiceEmail: string
  invoiceLanguage: string
  invoiceAddress: BillingInvoiceAddress
  /**
   * `YYYY-MM-DD`, only when the operator or upstream gave one. Omitted →
   * billing starts the account on the first cycle day on or after today.
   */
  nextBillDate?: string
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

/** Cycle fields as they arrive from one source (override or upstream). */
type CycleSource = {
  /** A unit outside `BILL_CYCLES` (e.g. a legacy 'quarterly') is mapped, not trusted. */
  billCycle?: string
  billCycleInterval?: number
  billCycleDay?: string | number | null
}

/**
 * The account's bill cycle (`every N <unit> on <day>`). The source that sets
 * the unit owns the interval and day, so an operator switching to weekly is
 * never combined with an upstream day of the month; an override that only
 * changes N or the day applies on top of the upstream unit. An omitted day
 * follows billing's own default (the day of `nextBillDate`, else '1' / 'mon').
 *
 * Overrides are validated on save, but upstream data is not: an invalid
 * combination falls back to the unit's defaults rather than failing the
 * persistent subscriber forever. Default: every 1 month on day 1.
 */
export function resolveCycleSpec(input: {
  overrides?: CycleSource | null
  defaults?: CycleSource | null
  nextBillDate?: string | null
}): CycleSpec {
  const o = input.overrides ?? {}
  const unitSource = o.billCycle !== undefined ? o : (input.defaults ?? {})
  const unit = resolveUnit(unitSource.billCycle)
  const cycle = unit.cycle
  const interval = o.billCycleInterval ?? unitSource.billCycleInterval ?? unit.interval
  const rawDay = o.billCycleDay !== undefined ? o.billCycleDay : unitSource.billCycleDay
  const anchor = input.nextBillDate ? new Date(`${input.nextBillDate}T00:00:00Z`) : null
  const fallbackDay = defaultCycleDay(cycle, anchor)
  const day = cycle === 'daily' ? null : rawDay === undefined || rawDay === null ? fallbackDay : normalizeCycleDay(rawDay)
  const spec: CycleSpec = { cycle, interval, day }
  const issue = validateCycleSpec(spec)
  if (!issue) return spec
  // Invalid upstream combination: keep the unit, replace what does not fit.
  return {
    cycle,
    interval: issue.path === 'billCycleInterval' ? DEFAULT_BILL_CYCLE_INTERVAL : interval,
    day: issue.path === 'billCycleDay' ? fallbackDay : day,
  }
}

/** Unknown units fall back to monthly; a legacy 'quarterly' is monthly × 3. */
function resolveUnit(raw: string | undefined): { cycle: BillCycle; interval: number } {
  if (raw === 'quarterly') return { cycle: 'monthly', interval: 3 }
  if (raw && (BILL_CYCLES as readonly string[]).includes(raw)) return { cycle: raw as BillCycle, interval: DEFAULT_BILL_CYCLE_INTERVAL }
  return { cycle: DEFAULT_BILL_CYCLE, interval: DEFAULT_BILL_CYCLE_INTERVAL }
}

/**
 * New-account values. Precedence per field (D5): operator override →
 * customer defaults from CPQ → placeholder.
 *
 * `nextBillDate`: override → upstream → omitted. Billing then starts the
 * account on the first bill cycle day on or after today; recurring items
 * that start later produce empty cycles until their bill start, so a delayed
 * start never bills the gap.
 */
export function buildAccountSeedValues(input: {
  defaults: CustomerDefaults
  currencyCode: string
  overrides?: AccountOverrides | null
}): AccountSeedValues {
  const { defaults, overrides } = input
  const o = overrides ?? {}
  const customerKind = o.customerKind ?? defaults.customerKind
  const nextBillDate = o.nextBillDate ?? toIsoDate(defaults.nextBillDate) ?? undefined
  const cycle = resolveCycleSpec({ overrides: o, defaults, nextBillDate })
  return {
    customerId: defaults.customerId,
    ...(customerKind ? { customerKind } : {}),
    name: o.name ?? text(defaults.customerName) ?? placeholderName(defaults.customerId),
    currencyCode: input.currencyCode,
    billCycle: cycle.cycle,
    billCycleInterval: cycle.interval,
    billCycleDay: cycle.day,
    invoiceEmail: o.invoiceEmail ?? text(defaults.invoiceEmail) ?? placeholderEmail(defaults.customerId),
    invoiceLanguage: o.invoiceLanguage ?? resolveInvoiceLanguage(defaults.invoiceLanguage),
    invoiceAddress: o.invoiceAddress
      ? { ...o.invoiceAddress }
      : normalizeInvoiceAddress(defaults.invoiceAddress),
    ...(nextBillDate ? { nextBillDate } : {}),
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
