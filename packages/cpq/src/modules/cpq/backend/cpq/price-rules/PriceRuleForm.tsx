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
import { NumberInput } from '../../../components/NumberInput'

// ─── Shared types ────────────────────────────────────────────────

export const RULE_TYPE_LABELS: Record<string, string> = {
  discount_percent: 'Discount %',
  discount_absolute: 'Discount $',
  surcharge_percent: 'Surcharge %',
  surcharge_absolute: 'Surcharge $',
  price_override: 'Override',
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
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <h2 className="text-lg font-semibold">{editingId ? 'Edit Rule' : 'New Rule'}</h2>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1">
          <span className="text-sm font-medium">Code</span>
          <Input
            value={form.code}
            onChange={(e) => onFormChange({ ...form, code: e.target.value })}
            disabled={!!editingId}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Name</span>
          <Input
            value={form.name}
            onChange={(e) => onFormChange({ ...form, name: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Rule Type</span>
          <Select
            value={form.ruleType}
            onValueChange={(value) => onFormChange({ ...form, ruleType: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Value</span>
          <NumberInput
            value={form.value === '' ? null : Number(form.value)}
            onChange={(n) => onFormChange({ ...form, value: n == null ? '' : String(n) })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Charge Type Filter</span>
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
              <SelectItem value="__all__">All charge types</SelectItem>
              <SelectItem value="nrc">NRC only</SelectItem>
              <SelectItem value="mrc">MRC only</SelectItem>
              <SelectItem value="usage">Usage only</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Charge Code Filter</span>
          <Input
            placeholder="e.g. setup_fee (leave empty for all)"
            value={form.chargeCodeFilter}
            onChange={(e) => onFormChange({ ...form, chargeCodeFilter: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Sort Order</span>
          <NumberInput
            integer
            value={form.sortOrder === '' ? null : Number(form.sortOrder)}
            onChange={(n) => onFormChange({ ...form, sortOrder: n == null ? '' : String(n) })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">Description</span>
          <Input
            placeholder="Optional"
            value={form.description}
            onChange={(e) => onFormChange({ ...form, description: e.target.value })}
          />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-sm font-medium">Product Offering</span>
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
              <SelectItem value="__global__">Global (all products)</SelectItem>
              {offerings.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            Leave as &quot;Global&quot; to apply to all products, or select a specific offering
          </span>
        </label>
        <div className="col-span-2 space-y-1">
          <span className="text-sm font-medium">Applicability Condition</span>
          <span className="ml-2 text-xs text-muted-foreground">
            (optional — only apply when a product attribute matches)
          </span>
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder="Attribute (e.g. port_size)"
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
                <SelectItem value="eq">equals (=)</SelectItem>
                <SelectItem value="neq">not equals (≠)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Value (e.g. 100G)"
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
        Active
      </label>
      <div className="flex gap-2">
        <Button type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
