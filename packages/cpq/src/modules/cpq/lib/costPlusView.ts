/**
 * Pure view helpers for the cost-plus charge editor (feature spec §UI/UX).
 * Client-safe: no service or ORM imports. The combination rules are the
 * shared `costElementShapeError`; the API stays the authority.
 */
import { costElementShapeError } from '../data/costs'

export const MARKUP_RULES = ['markup_percent', 'target_margin_percent', 'markup_absolute'] as const
export type MarkupRule = (typeof MARKUP_RULES)[number]

export const MARKUP_RULE_FALLBACKS: Record<MarkupRule, string> = {
  markup_percent: 'Markup % on cost',
  target_margin_percent: 'Target margin %',
  markup_absolute: 'Absolute markup per unit',
}

export const MARKUP_VALUE_HINTS: Record<MarkupRule, string> = {
  markup_percent: 'Price = cost × (1 + value / 100)',
  target_margin_percent: 'Price = cost ÷ (1 − value / 100); must be below 100',
  markup_absolute: 'Price = cost + value, in the charge currency',
}

/** Error / rule codes returned by the cost endpoints, with the text shown to the user. */
export const COST_ERROR_FALLBACKS: Record<string, string> = {
  COST_PLUS_DISABLED: 'Cost-plus pricing is turned off for this tenant.',
  NO_PRICE_BASIS_ELEMENT: 'An active cost-plus charge needs at least one active price-basis cost element.',
  PRICE_BASIS_REQUIRES_COST_PLUS: 'Price-basis costs are only valid on cost-plus charges.',
  COST_TYPE_MISMATCH: 'A price-basis cost must have the same type (NRC / MRC) as its charge.',
  WRONG_TABLE_PURPOSE: 'Pick a pricing table whose purpose is “cost”.',
  COST_TABLE_NOT_FOUND: 'The selected cost table was not found.',
  COLUMN_NOT_FOUND: 'The selected column does not exist on that table.',
  DUPLICATE_CODE: 'Another cost element on this charge already uses that code.',
  MODEL_REQUIRES_TABLE: 'Tiered and volume costs must come from a table.',
  QUANTITY_ATTRIBUTE_REQUIRED: 'The charge needs a quantity attribute for per-unit, tiered or volume costs.',
  SOURCE_NOT_AVAILABLE: 'That cost source is not available yet.',
  AMOUNT_REQUIRED: 'Enter an amount.',
  CURRENCY_REQUIRED: 'Choose a currency.',
  TABLE_REQUIRED: 'Pick a cost table and a column.',
  FIELD_NOT_ALLOWED: 'A field is set that does not apply to this source.',
  PURPOSE_LOCKED: 'The purpose cannot change while a charge or cost element references this table.',
  CODE_REQUIRED: 'Enter a code.',
  NAME_REQUIRED: 'Enter a name.',
  AMOUNT_INVALID: 'Enter a valid number.',
  PREVIEW_FAILED: 'The cost preview failed.',
  SAVE_FAILED: 'Failed to save the cost element.',
  COSTS_VIEW_REQUIRED: 'You need cost visibility to do this.',
}

export function costErrorMessage(code: string | null | undefined, fallback = 'Something went wrong'): string {
  if (!code) return fallback
  return COST_ERROR_FALLBACKS[code] ?? code
}

export type CostElementSource = 'fixed' | 'table' | 'on_request'
export type CostElementModel = 'flat' | 'per_unit' | 'tiered' | 'volume'

/** A cost element as returned by `GET /api/cpq/charge-cost-elements` (decimals are strings). */
export type CostElementRow = {
  id: string
  productChargeId: string
  code: string
  name: string
  role: 'price_basis' | 'margin_only'
  costType: 'nrc' | 'mrc'
  source: CostElementSource
  costModel: CostElementModel
  amount: string | null
  currencyCode: string | null
  costTableId: string | null
  costColumnKey: string | null
  estimateAmount: string | null
  defaultSupplierName: string | null
  defaultValidityDays: number | null
  requiresSourcing: boolean
  isActive: boolean
}

/** Form state of the add / edit dialog: every input is a string, as typed. */
export type CostElementForm = {
  code: string
  name: string
  role: 'price_basis' | 'margin_only'
  costType: 'nrc' | 'mrc'
  source: CostElementSource
  costModel: CostElementModel
  amount: string
  currencyCode: string
  costTableId: string
  costColumnKey: string
  estimateAmount: string
  defaultSupplierName: string
  defaultValidityDays: string
  requiresSourcing: boolean
  isActive: boolean
}

/** Price-basis costs are only valid on cost-plus charges, so other charges default to margin-only. */
export function emptyCostElementForm(chargeType: string | null | undefined, currencyCode?: string | null, isCostPlus = true): CostElementForm {
  return {
    code: '', name: '', role: isCostPlus ? 'price_basis' : 'margin_only', costType: chargeType === 'nrc' ? 'nrc' : 'mrc', source: 'fixed', costModel: 'flat',
    amount: '', currencyCode: currencyCode ?? 'USD', costTableId: '', costColumnKey: '', estimateAmount: '',
    defaultSupplierName: '', defaultValidityDays: '', requiresSourcing: false, isActive: true,
  }
}

export function costElementToForm(row: CostElementRow): CostElementForm {
  return {
    code: row.code, name: row.name, role: row.role, costType: row.costType, source: row.source, costModel: row.costModel,
    amount: row.amount ?? '', currencyCode: row.currencyCode ?? '', costTableId: row.costTableId ?? '', costColumnKey: row.costColumnKey ?? '',
    estimateAmount: row.estimateAmount ?? '', defaultSupplierName: row.defaultSupplierName ?? '',
    defaultValidityDays: row.defaultValidityDays != null ? String(row.defaultValidityDays) : '', requiresSourcing: row.requiresSourcing, isActive: row.isActive,
  }
}

const num = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** First field-only rule the form breaks, as an API rule code; null when it can be sent. */
export function costElementFormError(form: CostElementForm, mode: 'create' | 'edit' = 'create'): string | null {
  if (mode === 'create' && !form.code.trim()) return 'CODE_REQUIRED'
  if (!form.name.trim()) return 'NAME_REQUIRED'
  if (form.amount.trim() && num(form.amount) === null) return 'AMOUNT_INVALID'
  if (form.estimateAmount.trim() && num(form.estimateAmount) === null) return 'AMOUNT_INVALID'
  return costElementShapeError({
    role: form.role, costType: form.costType, source: form.source, costModel: form.costModel,
    amount: sourceFields(form).amount, currencyCode: sourceFields(form).currencyCode,
    costTableId: sourceFields(form).costTableId, costColumnKey: sourceFields(form).costColumnKey,
    estimateAmount: sourceFields(form).estimateAmount,
  })
}

/** Only the inputs that belong to the chosen source survive; the rest are nulled (so an edit clears them). */
function sourceFields(form: CostElementForm) {
  const amount = num(form.amount)
  const estimate = num(form.estimateAmount)
  if (form.source === 'fixed') {
    return { amount, currencyCode: form.currencyCode || null, costTableId: null, costColumnKey: null, estimateAmount: null }
  }
  if (form.source === 'table') {
    return { amount: null, currencyCode: null, costTableId: form.costTableId || null, costColumnKey: form.costColumnKey || null, estimateAmount: null }
  }
  return { amount: null, currencyCode: estimate !== null ? form.currencyCode || null : null, costTableId: null, costColumnKey: null, estimateAmount: estimate }
}

export function buildCostElementPayload(form: CostElementForm, mode: 'create' | 'edit', ids: { productChargeId?: string; id?: string }) {
  const days = num(form.defaultValidityDays)
  const body: Record<string, unknown> = {
    name: form.name.trim(), role: form.role, costType: form.costType, source: form.source, costModel: form.costModel,
    ...sourceFields(form),
    defaultSupplierName: form.defaultSupplierName.trim() || null,
    defaultValidityDays: days,
    requiresSourcing: form.requiresSourcing,
    isActive: form.isActive,
  }
  if (mode === 'create') return { productChargeId: ids.productChargeId, code: form.code.trim(), ...body }
  return { id: ids.id, ...body }
}

/** Models a cost element may use: tiered / volume need a quantity attribute on the charge. */
export function allowedCostModels(quantityAttributeCode: string | null | undefined): CostElementModel[] {
  return quantityAttributeCode ? ['flat', 'per_unit', 'tiered', 'volume'] : ['flat']
}

/** Cost-plus supports flat and per-unit NRC / MRC charges only. */
export function costPlusAllowed(charge: { chargeType: string; chargeModel: string | null }): boolean {
  return (charge.chargeType === 'nrc' || charge.chargeType === 'mrc') && (charge.chargeModel === null || charge.chargeModel === 'flat' || charge.chargeModel === 'per_unit')
}

export function countActivePriceBasis(items: Array<Pick<CostElementRow, 'role' | 'isActive'>>): number {
  return items.filter((item) => item.role === 'price_basis' && item.isActive).length
}
