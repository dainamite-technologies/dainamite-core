"use client"
import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NumberInput } from '../../../../components/NumberInput'
import { Input } from '@open-mercato/ui/primitives/input'
import { buildRuleTypeLabels } from '../PriceRuleForm'

type PriceRule = {
  id: string
  code: string
  name: string
  description: string | null
  productOfferingId: string | null
  ruleType: string
  value: number
  chargeCodeFilter: string | null
  chargeTypeFilter: string | null
  applicabilityCondition: Record<string, unknown> | null
  sortOrder: number
  isActive: boolean
  fromMonth?: number
  toMonth?: number | null
  validFrom?: string | null
  validUntil?: string | null
  createdAt: string
  updatedAt: string
}

type ProductOffering = { id: string; code: string; name: string }

type FormData = {
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
  fromMonth: string
  toMonth: string
  validFrom: string
  validUntil: string
}

function ruleToForm(rule: PriceRule): FormData {
  const cond = rule.applicabilityCondition as { attribute?: string; operator?: string; value?: string } | null
  return {
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
    fromMonth: rule.fromMonth && rule.fromMonth > 1 ? String(rule.fromMonth) : '',
    toMonth: rule.toMonth != null ? String(rule.toMonth) : '',
    validFrom: rule.validFrom ?? '',
    validUntil: rule.validUntil ?? '',
  }
}

export default function PriceRuleDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const ruleTypeLabels = React.useMemo(() => buildRuleTypeLabels(t), [t])
  const router = useRouter()
  const urlParams = useParams()
  const ruleId = (props.params?.id ?? urlParams?.id) as string

  const [rule, setRule] = React.useState<PriceRule | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [editing, setEditing] = React.useState(false)
  const [form, setForm] = React.useState<FormData | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  const [deleting, setDeleting] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  const [offerings, setOfferings] = React.useState<ProductOffering[]>([])

  React.useEffect(() => {
    fetch('/api/cpq/product-offerings?pageSize=100')
      .then((r) => r.json())
      .then((data) => setOfferings(data.items ?? []))
      .catch(() => {})
  }, [])

  const offeringLookup = React.useMemo(() => {
    const map = new Map<string, ProductOffering>()
    for (const o of offerings) map.set(o.id, o)
    return map
  }, [offerings])

  const loadRule = React.useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/cpq/price-rules?id=${ruleId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(t('cpq.priceRules.detail.notFound', 'Not found'))
        return r.json()
      })
      .then((data: PriceRule) => {
        setRule(data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [ruleId, t])

  React.useEffect(() => { loadRule() }, [loadRule])

  function startEdit() {
    if (!rule) return
    setForm(ruleToForm(rule))
    setSaveError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setForm(null)
    setSaveError(null)
  }

  async function handleSave() {
    if (!form || !rule) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload: Record<string, unknown> = {
        id: rule.id,
        name: form.name,
        ruleType: form.ruleType,
        value: Number(form.value),
        sortOrder: Number(form.sortOrder),
        isActive: form.isActive,
        productOfferingId: form.productOfferingId || null,
        // D9 / D10: always sent, so clearing a range or a date takes effect.
        fromMonth: form.fromMonth.trim() ? Number(form.fromMonth) : 1,
        toMonth: form.toMonth.trim() ? Number(form.toMonth) : null,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
      }
      if (form.description) payload.description = form.description
      else payload.description = null
      if (form.chargeCodeFilter) payload.chargeCodeFilter = form.chargeCodeFilter
      else payload.chargeCodeFilter = null
      if (form.chargeTypeFilter) payload.chargeTypeFilter = form.chargeTypeFilter
      else payload.chargeTypeFilter = null
      if (form.conditionAttribute) {
        payload.applicabilityCondition = {
          attribute: form.conditionAttribute,
          operator: form.conditionOperator || 'eq',
          value: form.conditionValue,
        }
      } else {
        payload.applicabilityCondition = null
      }

      const res = await fetch('/api/cpq/price-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? t('cpq.priceRules.errors.updateFailed', 'Failed to update'))
      }
      const updated = await res.json()
      setRule(updated)
      setEditing(false)
      setForm(null)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : t('cpq.priceRules.errors.unknown', 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch('/api/cpq/price-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ruleId }),
      })
      router.push('/backend/cpq/price-rules')
    } catch {
      setDeleting(false)
    }
  }

  async function handleToggleActive() {
    if (!rule) return
    const res = await fetch('/api/cpq/price-rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, isActive: !rule.isActive }),
    })
    if (res.ok) {
      const updated = await res.json()
      setRule(updated)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-12 text-center">{t('cpq.common.loading', 'Loading...')}</div>
  }

  if (error || !rule) {
    return (
      <div className="space-y-4 py-12 text-center">
        <div className="text-sm text-destructive">{error ?? t('cpq.priceRules.detail.ruleNotFound', 'Rule not found')}</div>
        <button
          onClick={() => router.push('/backend/cpq/price-rules')}
          className="text-sm text-primary hover:underline"
        >
          ← {t('cpq.priceRules.detail.backToList', 'Back to Price Rules')}
        </button>
      </div>
    )
  }

  const cond = rule.applicabilityCondition as { attribute?: string; operator?: string; value?: string } | null
  const offering = rule.productOfferingId ? offeringLookup.get(rule.productOfferingId) : null
  // `{name}` is left unresolved so the rule name can be rendered in <strong>.
  const deleteConfirmParts = t('cpq.priceRules.detail.deleteConfirm', 'Are you sure you want to delete {name}?').split('{name}')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/backend/cpq/price-rules')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← {t('cpq.common.back', 'Back')}
          </button>
          <h1 className="text-2xl font-bold">{rule.name}</h1>
          <Tag variant={rule.isActive ? 'success' : 'neutral'} dot>
            {rule.isActive ? t('cpq.common.active', 'Active') : t('cpq.common.inactive', 'Inactive')}
          </Tag>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={handleToggleActive}>
            {rule.isActive
              ? t('cpq.priceRules.detail.deactivate', 'Deactivate')
              : t('cpq.priceRules.detail.activate', 'Activate')}
          </Button>
          {!editing && (
            <button
              onClick={startEdit}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('cpq.common.edit', 'Edit')}
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-md border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            {t('cpq.common.delete', 'Delete')}
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between">
          <span className="text-sm">
            {deleteConfirmParts[0]}
            <strong>{rule.name}</strong>
            {deleteConfirmParts[1]}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting
                ? t('cpq.priceRules.detail.deleting', 'Deleting...')
                : t('cpq.priceRules.detail.confirmDelete', 'Yes, Delete')}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
            >
              {t('cpq.common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Edit mode */}
      {editing && form ? (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">{t('cpq.priceRules.form.editTitle', 'Edit Rule')}</h2>
          {saveError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{saveError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.code', 'Code')}</span>
              <input className="w-full rounded-md border bg-muted/30 px-3 py-2 text-sm" value={rule.code} disabled />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.name', 'Name')}</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.ruleType', 'Rule Type')}</span>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value })}>
                {Object.entries(ruleTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.value', 'Value')}</span>
              <NumberInput
                value={form.value === '' ? null : Number(form.value)}
                onChange={(n) => setForm({ ...form, value: n == null ? '' : String(n) })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.sortOrder', 'Sort Order')}</span>
              <NumberInput
                integer
                value={form.sortOrder === '' ? null : Number(form.sortOrder)}
                onChange={(n) => setForm({ ...form, sortOrder: n == null ? '' : String(n) })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.description', 'Description')}</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder={t('cpq.priceRules.form.descriptionPlaceholder', 'Optional')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.chargeTypeFilter', 'Charge Type Filter')}</span>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.chargeTypeFilter} onChange={(e) => setForm({ ...form, chargeTypeFilter: e.target.value })}>
                <option value="">{t('cpq.priceRules.form.allChargeTypes', 'All charge types')}</option>
                <option value="nrc">{t('cpq.priceRules.form.nrcOnly', 'NRC only')}</option>
                <option value="mrc">{t('cpq.priceRules.form.mrcOnly', 'MRC only')}</option>
                <option value="usage">{t('cpq.priceRules.form.usageOnly', 'Usage only')}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.chargeCodeFilter', 'Charge Code Filter')}</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder={t('cpq.priceRules.form.chargeCodeFilterPlaceholder', 'e.g. setup_fee (leave empty for all)')} value={form.chargeCodeFilter} onChange={(e) => setForm({ ...form, chargeCodeFilter: e.target.value })} />
            </label>
            <label className="space-y-1 col-span-2">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.productOffering', 'Product Offering')}</span>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.productOfferingId} onChange={(e) => setForm({ ...form, productOfferingId: e.target.value })}>
                <option value="">{t('cpq.priceRules.form.globalAllProducts', 'Global (all products)')}</option>
                {offerings.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
              </select>
            </label>
            <div className="col-span-2 space-y-1" data-testid="cpq-price-rule-phase">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.phase', 'Price phase (months)')}</span>
              <span className="ml-2 text-xs text-muted-foreground">{t('cpq.priceRules.form.phaseHint', '(optional — e.g. 1 to 1 = first month free; empty = every month; recurring charges only)')}</span>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput integer placeholder={t('cpq.priceRules.form.fromMonth', 'From month (1)')}
                  value={form.fromMonth === '' ? null : Number(form.fromMonth)}
                  onChange={(n) => setForm({ ...form, fromMonth: n == null ? '' : String(n) })} />
                <NumberInput integer placeholder={t('cpq.priceRules.form.toMonth', 'To month (to the end)')}
                  value={form.toMonth === '' ? null : Number(form.toMonth)}
                  onChange={(n) => setForm({ ...form, toMonth: n == null ? '' : String(n) })} />
              </div>
            </div>
            <div className="col-span-2 space-y-1" data-testid="cpq-price-rule-campaign">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.campaign', 'Campaign dates')}</span>
              <span className="ml-2 text-xs text-muted-foreground">{t('cpq.priceRules.form.campaignHint', '(optional — quotes priced in these dates get the rule; a priced quote keeps it after the end)')}</span>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" aria-label={t('cpq.priceRules.form.validFrom', 'Valid from')} value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
                <Input type="date" aria-label={t('cpq.priceRules.form.validUntil', 'Valid until')} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </div>
            </div>
            <div className="col-span-2 space-y-1">
              <span className="text-sm font-medium">{t('cpq.priceRules.form.applicabilityCondition', 'Applicability Condition')}</span>
              <span className="ml-2 text-xs text-muted-foreground">{t('cpq.priceRules.form.optionalHint', '(optional)')}</span>
              <div className="grid grid-cols-3 gap-2">
                <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder={t('cpq.priceRules.form.conditionAttributePlaceholder', 'Attribute (e.g. port_size)')} value={form.conditionAttribute} onChange={(e) => setForm({ ...form, conditionAttribute: e.target.value })} />
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.conditionOperator} onChange={(e) => setForm({ ...form, conditionOperator: e.target.value })}>
                  <option value="eq">{t('cpq.priceRules.form.operatorEq', 'equals (=)')}</option>
                  <option value="neq">{t('cpq.priceRules.form.operatorNeq', 'not equals (≠)')}</option>
                </select>
                <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder={t('cpq.priceRules.form.conditionValuePlaceholderShort', 'Value')} value={form.conditionValue} onChange={(e) => setForm({ ...form, conditionValue: e.target.value })} />
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {t('cpq.common.active', 'Active')}
          </label>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? t('cpq.common.saving', 'Saving...') : t('cpq.priceRules.detail.saveChanges', 'Save Changes')}
            </button>
            <button onClick={cancelEdit} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50">
              {t('cpq.common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        /* Read-only view */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Main info */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t('cpq.priceRules.detail.ruleConfiguration', 'Rule Configuration')}</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.code', 'Code')}</dt>
                <dd className="text-sm font-mono">{rule.code}</dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.ruleType', 'Rule Type')}</dt>
                <dd className="text-sm font-medium">{ruleTypeLabels[rule.ruleType] ?? rule.ruleType}</dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.value', 'Value')}</dt>
                <dd className="text-sm font-mono font-medium">
                  {rule.ruleType.includes('percent') ? `${rule.value}%` : rule.ruleType === 'price_override' ? `= $${rule.value}` : `$${rule.value}`}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.sortOrder', 'Sort Order')}</dt>
                <dd className="text-sm font-mono">{rule.sortOrder}</dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.phase', 'Months')}</dt>
                <dd className="text-sm" data-testid="cpq-price-rule-detail-phase">
                  {(rule.fromMonth ?? 1) === 1 && rule.toMonth == null
                    ? t('cpq.priceRules.detail.everyMonth', 'Every month')
                    : rule.toMonth == null
                      ? t('cpq.phases.monthsFrom', 'From month {from}', { from: rule.fromMonth ?? 1 })
                      : t('cpq.phases.months', 'Months {from}–{to}', { from: rule.fromMonth ?? 1, to: rule.toMonth })}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.form.campaign', 'Campaign dates')}</dt>
                <dd className="text-sm">
                  {rule.validFrom || rule.validUntil
                    ? `${rule.validFrom ?? '…'} – ${rule.validUntil ?? '…'}`
                    : t('cpq.priceRules.detail.noCampaign', 'Always')}
                </dd>
              </div>
              {rule.description && (
                <div className="border-t pt-3">
                  <dt className="text-sm text-muted-foreground mb-1">{t('cpq.priceRules.detail.description', 'Description')}</dt>
                  <dd className="text-sm">{rule.description}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Scope & Filters */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t('cpq.priceRules.detail.scopeAndFilters', 'Scope & Filters')}</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.scope', 'Scope')}</dt>
                <dd className="text-sm">
                  {offering ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-status-info-icon" />
                      {offering.name}
                      <span className="text-muted-foreground font-mono text-xs">({offering.code})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground" />
                      {t('cpq.priceRules.detail.globalAllOfferings', 'Global (all offerings)')}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.chargeType', 'Charge Type')}</dt>
                <dd className="text-sm">{rule.chargeTypeFilter ? rule.chargeTypeFilter.toUpperCase() : t('cpq.priceRules.detail.allTypes', 'All types')}</dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">{t('cpq.priceRules.detail.chargeCode', 'Charge Code')}</dt>
                <dd className="text-sm font-mono">{rule.chargeCodeFilter ?? t('cpq.priceRules.detail.allCharges', 'All charges')}</dd>
              </div>
              <div className="border-t pt-3">
                <dt className="text-sm text-muted-foreground mb-1">{t('cpq.priceRules.detail.applicabilityCondition', 'Applicability Condition')}</dt>
                <dd className="text-sm">
                  {cond?.attribute ? (
                    <code className="rounded bg-muted px-2 py-0.5 text-xs">
                      {cond.attribute} {cond.operator === 'neq' ? '≠' : '='} {cond.value ?? '""'}
                    </code>
                  ) : (
                    <span className="text-muted-foreground">{t('cpq.priceRules.detail.noCondition', 'No condition (always applies)')}</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Metadata */}
          <div className="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t('cpq.priceRules.detail.metadata', 'Metadata')}</h2>
            <dl className="flex gap-8 text-sm">
              <div>
                <dt className="text-muted-foreground">{t('cpq.priceRules.detail.created', 'Created')}</dt>
                <dd>{new Date(rule.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('cpq.priceRules.detail.updated', 'Updated')}</dt>
                <dd>{new Date(rule.updatedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('cpq.priceRules.detail.id', 'ID')}</dt>
                <dd className="font-mono text-xs">{rule.id}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
