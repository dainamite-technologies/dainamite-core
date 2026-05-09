"use client"
import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'

const RULE_TYPE_LABELS: Record<string, string> = {
  discount_percent: 'Discount %',
  discount_absolute: 'Discount $',
  surcharge_percent: 'Surcharge %',
  surcharge_absolute: 'Surcharge $',
  price_override: 'Override',
}

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
  }
}

export default function PriceRuleDetailPage(props: { params?: { id?: string } }) {
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
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then((data: PriceRule) => {
        setRule(data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [ruleId])

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
        throw new Error(err.error ?? 'Failed to update')
      }
      const updated = await res.json()
      setRule(updated)
      setEditing(false)
      setForm(null)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Unknown error')
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
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>
  }

  if (error || !rule) {
    return (
      <div className="space-y-4 py-12 text-center">
        <div className="text-sm text-destructive">{error ?? 'Rule not found'}</div>
        <button
          onClick={() => router.push('/backend/cpq/price-rules')}
          className="text-sm text-primary hover:underline"
        >
          &larr; Back to Price Rules
        </button>
      </div>
    )
  }

  const cond = rule.applicabilityCondition as { attribute?: string; operator?: string; value?: string } | null
  const offering = rule.productOfferingId ? offeringLookup.get(rule.productOfferingId) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/backend/cpq/price-rules')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold">{rule.name}</h1>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
            {rule.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleActive}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              rule.isActive
                ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                : 'border-green-200 text-green-700 hover:bg-green-50'
            }`}
          >
            {rule.isActive ? 'Deactivate' : 'Activate'}
          </button>
          {!editing && (
            <button
              onClick={startEdit}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Edit
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-md border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between">
          <span className="text-sm">Are you sure you want to delete <strong>{rule.name}</strong>?</span>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Edit mode */}
      {editing && form ? (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Edit Rule</h2>
          {saveError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{saveError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium">Code</span>
              <input className="w-full rounded-md border bg-muted/30 px-3 py-2 text-sm" value={rule.code} disabled />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Name</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Rule Type</span>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value })}>
                {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Value</span>
              <input type="number" step="any" className="w-full rounded-md border px-3 py-2 text-sm" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Sort Order</span>
              <input type="number" className="w-full rounded-md border px-3 py-2 text-sm" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Description</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Optional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Charge Type Filter</span>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.chargeTypeFilter} onChange={(e) => setForm({ ...form, chargeTypeFilter: e.target.value })}>
                <option value="">All charge types</option>
                <option value="nrc">NRC only</option>
                <option value="mrc">MRC only</option>
                <option value="usage">Usage only</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Charge Code Filter</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="e.g. setup_fee (leave empty for all)" value={form.chargeCodeFilter} onChange={(e) => setForm({ ...form, chargeCodeFilter: e.target.value })} />
            </label>
            <label className="space-y-1 col-span-2">
              <span className="text-sm font-medium">Product Offering</span>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.productOfferingId} onChange={(e) => setForm({ ...form, productOfferingId: e.target.value })}>
                <option value="">Global (all products)</option>
                {offerings.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
              </select>
            </label>
            <div className="col-span-2 space-y-1">
              <span className="text-sm font-medium">Applicability Condition</span>
              <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
              <div className="grid grid-cols-3 gap-2">
                <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Attribute (e.g. port_size)" value={form.conditionAttribute} onChange={(e) => setForm({ ...form, conditionAttribute: e.target.value })} />
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.conditionOperator} onChange={(e) => setForm({ ...form, conditionOperator: e.target.value })}>
                  <option value="eq">equals (=)</option>
                  <option value="neq">not equals (&#8800;)</option>
                </select>
                <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Value" value={form.conditionValue} onChange={(e) => setForm({ ...form, conditionValue: e.target.value })} />
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button onClick={cancelEdit} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Read-only view */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Main info */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Rule Configuration</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-muted-foreground">Code</dt>
                <dd className="text-sm font-mono">{rule.code}</dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">Rule Type</dt>
                <dd className="text-sm font-medium">{RULE_TYPE_LABELS[rule.ruleType] ?? rule.ruleType}</dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">Value</dt>
                <dd className="text-sm font-mono font-medium">
                  {rule.ruleType.includes('percent') ? `${rule.value}%` : rule.ruleType === 'price_override' ? `= $${rule.value}` : `$${rule.value}`}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">Sort Order</dt>
                <dd className="text-sm font-mono">{rule.sortOrder}</dd>
              </div>
              {rule.description && (
                <div className="border-t pt-3">
                  <dt className="text-sm text-muted-foreground mb-1">Description</dt>
                  <dd className="text-sm">{rule.description}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Scope & Filters */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Scope &amp; Filters</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-muted-foreground">Scope</dt>
                <dd className="text-sm">
                  {offering ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                      {offering.name}
                      <span className="text-muted-foreground font-mono text-xs">({offering.code})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
                      Global (all offerings)
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">Charge Type</dt>
                <dd className="text-sm">{rule.chargeTypeFilter ? rule.chargeTypeFilter.toUpperCase() : 'All types'}</dd>
              </div>
              <div className="flex justify-between border-t pt-3">
                <dt className="text-sm text-muted-foreground">Charge Code</dt>
                <dd className="text-sm font-mono">{rule.chargeCodeFilter ?? 'All charges'}</dd>
              </div>
              <div className="border-t pt-3">
                <dt className="text-sm text-muted-foreground mb-1">Applicability Condition</dt>
                <dd className="text-sm">
                  {cond?.attribute ? (
                    <code className="rounded bg-muted px-2 py-0.5 text-xs">
                      {cond.attribute} {cond.operator === 'neq' ? '≠' : '='} {cond.value ?? '""'}
                    </code>
                  ) : (
                    <span className="text-muted-foreground">No condition (always applies)</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Metadata */}
          <div className="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Metadata</h2>
            <dl className="flex gap-8 text-sm">
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(rule.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{new Date(rule.updatedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">ID</dt>
                <dd className="font-mono text-xs">{rule.id}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
