"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { NumberInput } from '../../../components/NumberInput'

// ─── Shared types ────────────────────────────────────────────────

/**
 * Display labels for price-rule types, keyed by the persisted `ruleType`
 * value. Single translatable source shared by the list, the create form and
 * the detail page — call inside render with the component's `t`.
 */
export function buildRuleTypeLabels(t: TranslateFn): Record<string, string> {
  return {
    discount_percent: t('cpq.priceRules.ruleTypes.discountPercent', 'Discount %'),
    discount_absolute: t('cpq.priceRules.ruleTypes.discountAbsolute', 'Discount $'),
    surcharge_percent: t('cpq.priceRules.ruleTypes.surchargePercent', 'Surcharge %'),
    surcharge_absolute: t('cpq.priceRules.ruleTypes.surchargeAbsolute', 'Surcharge $'),
    price_override: t('cpq.priceRules.ruleTypes.priceOverride', 'Override'),
  }
}

export type PriceRuleApplicabilityCondition = {
  attribute?: string
  operator?: string
  value?: string
}

export type PriceRule = {
  id: string
  code: string
  name: string
  description: string | null
  productOfferingId: string | null
  productOfferingName: string | null
  ruleType: string
  value: number
  chargeCodeFilter: string | null
  chargeTypeFilter: string | null
  applicabilityCondition: Record<string, unknown> | null
  sortOrder: number
  isActive: boolean
}

export type ProductOffering = { id: string; code: string; name: string }

export type PriceRuleFormData = {
  code: string
  name: string
  description: string
  productOfferingId: string
  ruleType: string
  value: string
  chargeCodeFilter: string
  chargeTypeFilter: string
  conditionAttribute: string
  conditionOperator: string
  conditionValue: string
  sortOrder: string
  isActive: boolean
}

export const emptyPriceRuleForm: PriceRuleFormData = {
  code: '',
  name: '',
  description: '',
  productOfferingId: '',
  ruleType: 'discount_percent',
  value: '',
  chargeCodeFilter: '',
  chargeTypeFilter: '',
  conditionAttribute: '',
  conditionOperator: 'eq',
  conditionValue: '',
  sortOrder: '0',
  isActive: true,
}

export function priceRuleToFormData(rule: PriceRule): PriceRuleFormData {
  const cond = rule.applicabilityCondition as PriceRuleApplicabilityCondition | null
  return {
    code: rule.code,
    name: rule.name,
    description: rule.description ?? '',
    productOfferingId: rule.productOfferingId ?? '',
    ruleType: rule.ruleType,
    value: String(rule.value),
    chargeCodeFilter: rule.chargeCodeFilter ?? '',
    chargeTypeFilter: rule.chargeTypeFilter ?? '',
    conditionAttribute: cond?.attribute ?? '',
    conditionOperator: cond?.operator ?? 'eq',
    conditionValue: cond?.value ?? '',
    sortOrder: String(rule.sortOrder),
    isActive: rule.isActive,
  }
}

export function priceRuleFormToPayload(form: PriceRuleFormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    code: form.code,
    name: form.name,
    ruleType: form.ruleType,
    value: Number(form.value),
    sortOrder: Number(form.sortOrder),
    isActive: form.isActive,
    productOfferingId: form.productOfferingId || null,
  }
  if (form.description) payload.description = form.description
  if (form.chargeCodeFilter) payload.chargeCodeFilter = form.chargeCodeFilter
  if (form.chargeTypeFilter) payload.chargeTypeFilter = form.chargeTypeFilter
  if (form.conditionAttribute) {
    payload.applicabilityCondition = {
      attribute: form.conditionAttribute,
      operator: form.conditionOperator || 'eq',
      value: form.conditionValue,
    }
  } else {
    payload.applicabilityCondition = null
  }
  return payload
}

// ─── Form component ──────────────────────────────────────────────

type PriceRuleFormProps = {
  editingId: string | null
  form: PriceRuleFormData
  onFormChange: (next: PriceRuleFormData) => void
  offerings: ProductOffering[]
  saving: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
}

export function PriceRuleForm({
  editingId,
  form,
  onFormChange,
  offerings,
  saving,
  error,
  onSave,
  onCancel,
}: PriceRuleFormProps) {
  const t = useT()
  const ruleTypeLabels = buildRuleTypeLabels(t)
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <h2 className="text-lg font-semibold">{editingId ? t('cpq.priceRules.form.editTitle', 'Edit Rule') : t('cpq.priceRules.form.newTitle', 'New Rule')}</h2>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.code', 'Code')}</span>
          <Input
            value={form.code}
            onChange={(e) => onFormChange({ ...form, code: e.target.value })}
            disabled={!!editingId}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.name', 'Name')}</span>
          <Input
            value={form.name}
            onChange={(e) => onFormChange({ ...form, name: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.ruleType', 'Rule Type')}</span>
          <Select
            value={form.ruleType}
            onValueChange={(value) => onFormChange({ ...form, ruleType: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ruleTypeLabels).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.value', 'Value')}</span>
          <NumberInput
            value={form.value === '' ? null : Number(form.value)}
            onChange={(n) => onFormChange({ ...form, value: n == null ? '' : String(n) })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.chargeTypeFilter', 'Charge Type Filter')}</span>
          <Select
            value={form.chargeTypeFilter || '__all__'}
            onValueChange={(value) =>
              onFormChange({ ...form, chargeTypeFilter: value === '__all__' ? '' : value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('cpq.priceRules.form.allChargeTypes', 'All charge types')}</SelectItem>
              <SelectItem value="nrc">{t('cpq.priceRules.form.nrcOnly', 'NRC only')}</SelectItem>
              <SelectItem value="mrc">{t('cpq.priceRules.form.mrcOnly', 'MRC only')}</SelectItem>
              <SelectItem value="usage">{t('cpq.priceRules.form.usageOnly', 'Usage only')}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.chargeCodeFilter', 'Charge Code Filter')}</span>
          <Input
            placeholder={t('cpq.priceRules.form.chargeCodeFilterPlaceholder', 'e.g. setup_fee (leave empty for all)')}
            value={form.chargeCodeFilter}
            onChange={(e) => onFormChange({ ...form, chargeCodeFilter: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.sortOrder', 'Sort Order')}</span>
          <NumberInput
            integer
            value={form.sortOrder === '' ? null : Number(form.sortOrder)}
            onChange={(n) => onFormChange({ ...form, sortOrder: n == null ? '' : String(n) })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.description', 'Description')}</span>
          <Input
            placeholder={t('cpq.priceRules.form.descriptionPlaceholder', 'Optional')}
            value={form.description}
            onChange={(e) => onFormChange({ ...form, description: e.target.value })}
          />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.productOffering', 'Product Offering')}</span>
          <Select
            value={form.productOfferingId || '__global__'}
            onValueChange={(value) =>
              onFormChange({ ...form, productOfferingId: value === '__global__' ? '' : value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__global__">{t('cpq.priceRules.form.globalAllProducts', 'Global (all products)')}</SelectItem>
              {offerings.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {t('cpq.priceRules.form.productOfferingHint', 'Leave as "Global" to apply to all products, or select a specific offering')}
          </span>
        </label>
        <div className="col-span-2 space-y-1">
          <span className="text-sm font-medium">{t('cpq.priceRules.form.applicabilityCondition', 'Applicability Condition')}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {t('cpq.priceRules.form.applicabilityConditionHint', '(optional — only apply when a product attribute matches)')}
          </span>
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder={t('cpq.priceRules.form.conditionAttributePlaceholder', 'Attribute (e.g. port_size)')}
              value={form.conditionAttribute}
              onChange={(e) => onFormChange({ ...form, conditionAttribute: e.target.value })}
            />
            <Select
              value={form.conditionOperator}
              onValueChange={(value) => onFormChange({ ...form, conditionOperator: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eq">{t('cpq.priceRules.form.operatorEq', 'equals (=)')}</SelectItem>
                <SelectItem value="neq">{t('cpq.priceRules.form.operatorNeq', 'not equals (≠)')}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={t('cpq.priceRules.form.conditionValuePlaceholder', 'Value (e.g. 100G)')}
              value={form.conditionValue}
              onChange={(e) => onFormChange({ ...form, conditionValue: e.target.value })}
            />
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.isActive}
          onCheckedChange={(checked) => onFormChange({ ...form, isActive: checked === true })}
        />
        {t('cpq.common.active', 'Active')}
      </label>
      <div className="flex gap-2">
        <Button type="button" onClick={onSave} disabled={saving}>
          {saving
            ? t('cpq.common.saving', 'Saving...')
            : editingId
              ? t('cpq.priceRules.form.update', 'Update')
              : t('cpq.priceRules.form.create', 'Create')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cpq.common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}
