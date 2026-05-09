"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
}

type ProductOffering = { id: string; code: string; name: string }

type FormData = {
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

const emptyForm: FormData = {
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

export default function PriceRulesPage() {
  const t = useT()
  const router = useRouter()
  const [items, setItems] = React.useState<PriceRule[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<FormData>(emptyForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [offerings, setOfferings] = React.useState<ProductOffering[]>([])

  React.useEffect(() => {
    fetch('/api/cpq/product-offerings?pageSize=100')
      .then((r) => r.json())
      .then((data) => setOfferings(data.items ?? []))
      .catch(() => {})
  }, [])

  const offeringLookup = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const o of offerings) map.set(o.id, o.name)
    return map
  }, [offerings])

  const loadRules = React.useCallback(() => {
    setLoading(true)
    fetch('/api/cpq/price-rules?pageSize=100')
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? []))
      .catch((err) => console.error('Failed to load price rules', err))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => { loadRules() }, [loadRules])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEdit(rule: PriceRule) {
    setEditingId(rule.id)
    const cond = rule.applicabilityCondition as { attribute?: string; operator?: string; value?: string } | null
    setForm({
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
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
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

      if (editingId) {
        payload.id = editingId
        const res = await fetch('/api/cpq/price-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error ?? 'Failed to update')
        }
      } else {
        const res = await fetch('/api/cpq/price-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.details ? JSON.stringify(err.details) : err.error ?? 'Failed to create')
        }
      }
      setShowForm(false)
      loadRules()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(rule: PriceRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return
    await fetch('/api/cpq/price-rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id }),
    })
    loadRules()
  }

  function formatValue(rule: PriceRule) {
    if (rule.ruleType.includes('percent')) return `${rule.value}%`
    if (rule.ruleType === 'price_override') return `= ${rule.value}`
    return `${rule.value}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('cpq.priceRules.list.title', 'Price Rules')}</h1>
        <button
          onClick={openCreate}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('cpq.priceRules.create', 'Create Rule')}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">{editingId ? 'Edit Rule' : 'New Rule'}</h2>
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-sm font-medium">Code</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editingId} />
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
            <label className="space-y-1">
              <span className="text-sm font-medium">Sort Order</span>
              <input type="number" className="w-full rounded-md border px-3 py-2 text-sm" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Description</span>
              <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Optional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="space-y-1 col-span-2">
              <span className="text-sm font-medium">Product Offering</span>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.productOfferingId} onChange={(e) => setForm({ ...form, productOfferingId: e.target.value })}>
                <option value="">Global (all products)</option>
                {offerings.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
              </select>
              <span className="text-xs text-muted-foreground">Leave as &quot;Global&quot; to apply to all products, or select a specific offering</span>
            </label>
            <div className="col-span-2 space-y-1">
              <span className="text-sm font-medium">Applicability Condition</span>
              <span className="ml-2 text-xs text-muted-foreground">(optional — only apply when a product attribute matches)</span>
              <div className="grid grid-cols-3 gap-2">
                <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Attribute (e.g. port_size)" value={form.conditionAttribute} onChange={(e) => setForm({ ...form, conditionAttribute: e.target.value })} />
                <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.conditionOperator} onChange={(e) => setForm({ ...form, conditionOperator: e.target.value })}>
                  <option value="eq">equals (=)</option>
                  <option value="neq">not equals (≠)</option>
                </select>
                <input className="w-full rounded-md border px-3 py-2 text-sm" placeholder="Value (e.g. 100G)" value={form.conditionValue} onChange={(e) => setForm({ ...form, conditionValue: e.target.value })} />
              </div>
              <span className="text-xs text-muted-foreground">Leave attribute empty for no condition. Examples: port_size = 100G, cloud_provider ≠ (empty), data_centre = equinix-ld5</span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No price rules found. Click &quot;Create Rule&quot; to add one.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Code</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Value</th>
                <th className="px-4 py-3 text-left font-medium">Scope</th>
                <th className="px-4 py-3 text-left font-medium">Filter</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((rule) => (
                <tr
                  key={rule.id}
                  className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/backend/cpq/price-rules/${rule.id}`)}
                >
                  <td className="px-4 py-3 text-muted-foreground">{rule.sortOrder}</td>
                  <td className="px-4 py-3 font-medium text-primary hover:underline">{rule.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{rule.code}</td>
                  <td className="px-4 py-3">{RULE_TYPE_LABELS[rule.ruleType] ?? rule.ruleType}</td>
                  <td className="px-4 py-3 font-mono">{formatValue(rule)}</td>
                  <td className="px-4 py-3 text-xs">{rule.productOfferingId ? (offeringLookup.get(rule.productOfferingId) ?? 'Product-scoped') : 'Global'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {(() => {
                      const parts: string[] = []
                      if (rule.chargeTypeFilter) parts.push(rule.chargeTypeFilter)
                      if (rule.chargeCodeFilter) parts.push(rule.chargeCodeFilter)
                      const cond = rule.applicabilityCondition as { attribute?: string; operator?: string; value?: string } | null
                      if (cond?.attribute) {
                        const op = cond.operator === 'neq' ? '≠' : '='
                        parts.push(`${cond.attribute} ${op} ${cond.value ?? '""'}`)
                      }
                      return parts.length > 0 ? parts.join(' / ') : '—'
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(rule)} className="rounded px-2 py-1 text-xs border hover:bg-muted/50">Edit</button>
                      <button onClick={() => handleDelete(rule)} className="rounded px-2 py-1 text-xs border text-destructive hover:bg-destructive/10">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
