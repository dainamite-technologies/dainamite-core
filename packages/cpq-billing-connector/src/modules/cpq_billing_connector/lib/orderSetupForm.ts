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
  billCycleAnchor: string
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

export type FormIssue = 'accountRequired' | 'nameRequired' | 'emailInvalid' | 'addressIncomplete'

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
    billCycleAnchor: defaults.billCycleAnchor,
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
  if (overrides.billCycleAnchor !== undefined) next.billCycleAnchor = overrides.billCycleAnchor
  if (overrides.nextBillDate !== undefined) next.nextBillDate = overrides.nextBillDate
  if (overrides.taxId !== undefined) next.taxId = overrides.taxId ?? ''
  return next
}

/**
 * Initial form state. A saved setup wins. Otherwise (D4): exactly one usable
 * account → preselect it; none → "create new"; several → "use existing"
 * with nothing selected, so the operator must pick.
 */
export function initialFormState(view: OrderSetupView, candidates: AccountOption[]): OrderSetupFormState {
  const base = defaultAccountFields(view.defaults.account)
  if (view.setup) {
    return {
      accountMode: view.setup.accountMode,
      billingAccountId: view.setup.billingAccountId,
      account: applyOverrides(base, view.setup.accountOverrides),
      defaultBillStartDate: view.setup.defaultBillStartDate ?? '',
      lineBillStarts: { ...view.setup.lineBillStarts },
    }
  }
  return {
    accountMode: candidates.length === 0 ? 'new' : 'existing',
    billingAccountId: candidates.length === 1 ? candidates[0].id : null,
    account: base,
    defaultBillStartDate: '',
    lineBillStarts: {},
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
  if (changed('billCycle')) o.billCycle = fields.billCycle as AccountOverrides['billCycle']
  if (changed('billCycleAnchor') && fields.billCycleAnchor.trim()) o.billCycleAnchor = fields.billCycleAnchor.trim()
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
      nextBillDate:
        typeof (row.next_bill_date ?? row.nextBillDate) === 'string'
          ? String(row.next_bill_date ?? row.nextBillDate).slice(0, 10)
          : null,
    })
  }
  return out
}
