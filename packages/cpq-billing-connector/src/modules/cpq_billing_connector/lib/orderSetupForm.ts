import {
  BILL_CYCLES,
  BILL_CYCLE_INTERVAL_MAX,
  defaultCycleDay,
  validateCycleSpec,
  type BillCycle,
} from '@dainamite/billing/modules/billing/lib/billCycle'
import type { AccountOverrides, OrderSetupUpsertBody } from '../data/validators'
import type { OrderSetupView } from '../services/orderSetupService'
import { isArcQuoteType } from './orderSetupResolution'

/**
 * Pure form-state helpers of the Billing tab widget: view → form state, and
 * form state → `PUT` body. Kept free of React so they can be unit-tested.
 */

/** A billing account offered in "Use existing" (from `GET /api/billing/accounts`). */
export type AccountOption = {
  id: string
  name: string
  currencyCode: string
  billCycle: string | null
  billCycleInterval: number | null
  billCycleDay: string | null
  nextBillDate: string | null
}

export type AccountFields = {
  name: string
  customerKind: '' | 'company' | 'person'
  invoiceEmail: string
  invoiceLanguage: string
  line1: string
  line2: string
  city: string
  postalCode: string
  country: string
  billCycle: string
  /** "Every N units" as typed (validated by `validateForm`). */
  billCycleInterval: string
  /** '1'–'31' | 'mon'–'sun'; '' for a daily cycle. */
  billCycleDay: string
  /** '' = billing's first cycle day on or after today. */
  nextBillDate: string
  taxId: string
}

export type OrderSetupFormState = {
  accountMode: 'existing' | 'new'
  billingAccountId: string | null
  account: AccountFields
  /** '' = on activation date. */
  defaultBillStartDate: string
  /** Only lines with an explicit bill start. */
  lineBillStarts: Record<string, string>
}

export type FormIssue = 'accountRequired' | 'nameRequired' | 'emailInvalid' | 'addressIncomplete' | 'cycleInvalid'

/** New-account fields as the customer defines them (no operator overrides). */
export function defaultAccountFields(defaults: OrderSetupView['defaults']['account']): AccountFields {
  return {
    name: defaults.name ?? '',
    customerKind: defaults.customerKind ?? '',
    invoiceEmail: defaults.invoiceEmail ?? '',
    invoiceLanguage: defaults.invoiceLanguage,
    line1: defaults.invoiceAddress?.line1 ?? '',
    line2: defaults.invoiceAddress?.line2 ?? '',
    city: defaults.invoiceAddress?.city ?? '',
    postalCode: defaults.invoiceAddress?.postal_code ?? '',
    country: defaults.invoiceAddress?.country ?? '',
    billCycle: defaults.billCycle,
    billCycleInterval: String(defaults.billCycleInterval),
    billCycleDay: defaults.billCycleDay ?? '',
    nextBillDate: '',
    taxId: '',
  }
}

function applyOverrides(base: AccountFields, overrides: AccountOverrides): AccountFields {
  const next = { ...base }
  if (overrides.name !== undefined) next.name = overrides.name
  if (overrides.customerKind !== undefined) next.customerKind = overrides.customerKind
  if (overrides.invoiceEmail !== undefined) next.invoiceEmail = overrides.invoiceEmail
  if (overrides.invoiceLanguage !== undefined) next.invoiceLanguage = overrides.invoiceLanguage
  if (overrides.invoiceAddress !== undefined) {
    next.line1 = overrides.invoiceAddress.line1
    next.line2 = overrides.invoiceAddress.line2 ?? ''
    next.city = overrides.invoiceAddress.city
    next.postalCode = overrides.invoiceAddress.postal_code
    next.country = overrides.invoiceAddress.country
  }
  if (overrides.billCycle !== undefined) next.billCycle = overrides.billCycle
  if (overrides.billCycleInterval !== undefined) next.billCycleInterval = String(overrides.billCycleInterval)
  if (overrides.billCycleDay !== undefined) next.billCycleDay = overrides.billCycleDay ?? ''
  if (overrides.nextBillDate !== undefined) next.nextBillDate = overrides.nextBillDate
  if (overrides.taxId !== undefined) next.taxId = overrides.taxId ?? ''
  return next
}

/**
 * The saved setup points at an account that is no longer offered (deactivated,
 * deleted, or its currency / customer no longer match). Only decidable when
 * the user may list accounts — otherwise every saved account looks missing.
 */
export function isSavedAccountUnavailable(
  view: OrderSetupView,
  candidates: AccountOption[],
  canListAccounts: boolean,
): boolean {
  const saved = view.setup
  if (!canListAccounts || !saved || saved.appliedAt) return false
  if (saved.accountMode !== 'existing' || !saved.billingAccountId) return false
  return !candidates.some((option) => option.id === saved.billingAccountId)
}

/**
 * Initial form state. A saved setup wins — unless its account is no longer
 * offered (`savedAccountUnavailable`): then the account choice is re-derived
 * from the candidates below, so the operator is not left on a selection the
 * server would reject with 422. Otherwise (D4): exactly one usable account →
 * preselect it; none → "create new"; several → "use existing" with nothing
 * selected, so the operator must pick.
 */
export function initialFormState(
  view: OrderSetupView,
  candidates: AccountOption[],
  options: { savedAccountUnavailable?: boolean } = {},
): OrderSetupFormState {
  const base = defaultAccountFields(view.defaults.account)
  const derivedAccount = {
    accountMode: candidates.length === 0 ? ('new' as const) : ('existing' as const),
    billingAccountId: candidates.length === 1 ? candidates[0].id : null,
  }
  if (view.setup) {
    return {
      ...(options.savedAccountUnavailable
        ? derivedAccount
        : { accountMode: view.setup.accountMode, billingAccountId: view.setup.billingAccountId }),
      account: applyOverrides(base, view.setup.accountOverrides),
      defaultBillStartDate: view.setup.defaultBillStartDate ?? '',
      lineBillStarts: { ...view.setup.lineBillStarts },
    }
  }
  return {
    ...derivedAccount,
    account: base,
    defaultBillStartDate: '',
    lineBillStarts: {},
  }
}

/** "Every N" as a whole number, or null when it is not one. */
export function parseCycleInterval(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number.parseInt(trimmed, 10)
}

function isBillCycle(value: string): value is BillCycle {
  return (BILL_CYCLES as readonly string[]).includes(value)
}

/** True when the form's unit / N / day make a cycle billing accepts. */
export function isCycleValid(fields: Pick<AccountFields, 'billCycle' | 'billCycleInterval' | 'billCycleDay'>): boolean {
  const interval = parseCycleInterval(fields.billCycleInterval)
  if (!isBillCycle(fields.billCycle) || interval === null) return false
  const day = fields.billCycle === 'daily' ? null : fields.billCycleDay || null
  return validateCycleSpec({ cycle: fields.billCycle, interval, day }) === null
}

/**
 * Switching the unit: the day shape changes (day of month ↔ weekday), so the
 * day resets to the unit default, and N is capped at the unit's maximum.
 */
export function changeCycleUnit(fields: AccountFields, unit: BillCycle): AccountFields {
  const interval = parseCycleInterval(fields.billCycleInterval)
  const max = BILL_CYCLE_INTERVAL_MAX[unit]
  return {
    ...fields,
    billCycle: unit,
    billCycleDay: defaultCycleDay(unit, null) ?? '',
    billCycleInterval: interval !== null && interval > max ? String(max) : fields.billCycleInterval,
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateForm(state: OrderSetupFormState, quoteType = 'new'): FormIssue[] {
  const issues: FormIssue[] = []
  // ARC orders set bill starts only — the account is the subscription's.
  if (isArcQuoteType(quoteType)) return issues
  if (state.accountMode === 'existing') {
    if (!state.billingAccountId) issues.push('accountRequired')
    return issues
  }
  const a = state.account
  if (!a.name.trim()) issues.push('nameRequired')
  if (a.invoiceEmail.trim() && !EMAIL_PATTERN.test(a.invoiceEmail.trim())) issues.push('emailInvalid')
  const addressParts = [a.line1, a.city, a.postalCode, a.country].map((v) => v.trim())
  const anyAddress = addressParts.some(Boolean) || a.line2.trim().length > 0
  if (anyAddress && addressParts.some((v) => !v)) issues.push('addressIncomplete')
  if (!isCycleValid(a)) issues.push('cycleInvalid')
  return issues
}

/**
 * Overrides = only the fields that differ from the customer's values (D5),
 * so a later fix on the customer still flows into the new account.
 */
export function buildOverrides(fields: AccountFields, base: AccountFields): AccountOverrides {
  const o: AccountOverrides = {}
  const changed = (key: keyof AccountFields) => fields[key].trim() !== base[key].trim()
  if (changed('name') && fields.name.trim()) o.name = fields.name.trim()
  if (changed('customerKind') && fields.customerKind) o.customerKind = fields.customerKind
  if (changed('invoiceEmail') && fields.invoiceEmail.trim()) o.invoiceEmail = fields.invoiceEmail.trim()
  if (changed('invoiceLanguage')) o.invoiceLanguage = fields.invoiceLanguage as AccountOverrides['invoiceLanguage']
  const addressKeys = ['line1', 'line2', 'city', 'postalCode', 'country'] as const
  if (addressKeys.some(changed) && fields.line1.trim()) {
    o.invoiceAddress = {
      line1: fields.line1.trim(),
      ...(fields.line2.trim() ? { line2: fields.line2.trim() } : {}),
      city: fields.city.trim(),
      postal_code: fields.postalCode.trim(),
      country: fields.country.trim().toUpperCase(),
    }
  }
  // The cycle is one spec: any change sends unit, N and day together, so the
  // server validates (and billing applies) a consistent combination.
  if (changed('billCycle') || changed('billCycleInterval') || changed('billCycleDay')) {
    o.billCycle = fields.billCycle as AccountOverrides['billCycle']
    const interval = parseCycleInterval(fields.billCycleInterval)
    if (interval !== null) o.billCycleInterval = interval
    o.billCycleDay = fields.billCycle === 'daily' ? null : fields.billCycleDay.trim() || null
  }
  if (fields.nextBillDate) o.nextBillDate = fields.nextBillDate
  if (fields.taxId.trim()) o.taxId = fields.taxId.trim()
  return o
}

export function buildUpsertBody(state: OrderSetupFormState, view: OrderSetupView): OrderSetupUpsertBody {
  const lineBillStarts = Object.fromEntries(
    Object.entries(state.lineBillStarts).filter(([, date]) => Boolean(date)),
  )
  const common = {
    defaultBillStartDate: state.defaultBillStartDate || null,
    lineBillStarts,
  }
  if (isArcQuoteType(view.quoteType)) return common
  if (state.accountMode === 'existing') {
    return { accountMode: 'existing', billingAccountId: state.billingAccountId, ...common }
  }
  return {
    accountMode: 'new',
    accountOverrides: buildOverrides(state.account, defaultAccountFields(view.defaults.account)),
    ...common,
  }
}

/** Raw `GET /api/billing/accounts` rows → options (snake_case or camelCase). */
export function toAccountOptions(rows: unknown, target: { currencyCode: string }): AccountOption[] {
  const items = Array.isArray(rows)
    ? rows
    : Array.isArray((rows as { items?: unknown } | null)?.items)
      ? (rows as { items: unknown[] }).items
      : []
  const out: AccountOption[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : null
    const currency = String(row.currency_code ?? row.currencyCode ?? '').toUpperCase()
    const active = row.is_active ?? row.isActive
    if (!id || currency !== target.currencyCode.toUpperCase() || active === false) continue
    out.push({
      id,
      name: String(row.name ?? id),
      currencyCode: currency,
      billCycle: typeof (row.bill_cycle ?? row.billCycle) === 'string' ? String(row.bill_cycle ?? row.billCycle) : null,
      billCycleInterval: toPositiveInt(row.bill_cycle_interval ?? row.billCycleInterval),
      billCycleDay:
        typeof (row.bill_cycle_day ?? row.billCycleDay) === 'string' ? String(row.bill_cycle_day ?? row.billCycleDay) : null,
      nextBillDate:
        typeof (row.next_bill_date ?? row.nextBillDate) === 'string'
          ? String(row.next_bill_date ?? row.nextBillDate).slice(0, 10)
          : null,
    })
  }
  return out
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(n) && n > 0 ? n : null
}
