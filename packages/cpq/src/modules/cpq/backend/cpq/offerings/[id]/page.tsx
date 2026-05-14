"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams, useRouter } from 'next/navigation'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { NumberInput } from '../../../../components/NumberInput'
import {
  chargeTypeMap,
  formatStatusLabel,
  lifecycleStatusMap,
  type ChargeType,
  type LifecycleStatus,
} from '../../../../components/statusMaps'

// ─── Types ──────────────────────────────────────────────────────

type OfferingComponent = {
  id: string
  slotId: string
  slot: { id: string; componentGroup: string; name: string; cardinalityMin: number; cardinalityMax: number | null } | null
  childOfferingId: string
  childOffering: { id: string; code: string; name: string; offeringType: string; specId: string } | null
  isDefault: boolean
  sortOrder: number
  isActive: boolean
}

type BundleSlot = {
  id: string
  componentGroup: string
  name: string
  targetSpecId: string
  targetSpec: { id: string; code: string; name: string; specType: string } | null
  cardinalityMin: number
  cardinalityMax: number | null
  sortOrder: number
}

type Offering = {
  id: string
  specId: string
  catalogOfferId: string | null
  code: string
  name: string
  description: string | null
  offeringType: string
  designTimeValues: Record<string, unknown>
  lifecycleStatus: string
  effectiveFrom: string | null
  effectiveTo: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  specification: { id: string; code: string; name: string; productId: string; specType?: string } | null
  charges: Charge[]
  components?: OfferingComponent[]
}

type Charge = {
  id: string
  code: string
  name: string
  description: string | null
  chargeType: string
  pricingMethod: string
  pricingTableId: string | null
  priceColumnKey: string | null
  fixedPrice: string | null
  currencyCode: string | null
  quantityAttributeCode: string | null
  applicabilityCondition: Record<string, unknown> | null
  sortOrder: number
  isActive: boolean
}

type Attribute = {
  id: string
  code: string
  name: string
  attributeType: string
  resolutionTime: string
  options: Array<{ value: string; label: string }> | null
  constraints: Record<string, unknown> | null
  defaultValue: unknown | null
  helpText: string | null
  sortOrder: number
  isRequired: boolean
  isActive: boolean
}

type Specification = {
  id: string
  code: string
  name: string
  productId: string
}

type PricingTableRef = { id: string; code: string; name: string; dimensions: Array<{ key: string; label: string }>; priceColumns: Array<{ key: string; label: string }> }

type EditingCharge = Omit<Charge, 'id'> & { id?: string }

// ─── Defaults ───────────────────────────────────────────────────

const EMPTY_FORM = {
  code: '',
  name: '',
  description: '',
  offeringType: 'simple' as string,
  lifecycleStatus: 'draft',
  effectiveFrom: null as string | null,
  effectiveTo: null as string | null,
  isActive: true,
  specId: '',
}

const EMPTY_CHARGE: EditingCharge = {
  code: '',
  name: '',
  description: null,
  chargeType: 'mrc',
  pricingMethod: 'flat',
  pricingTableId: null,
  priceColumnKey: null,
  fixedPrice: null,
  currencyCode: 'USD',
  quantityAttributeCode: null,
  applicabilityCondition: null,
  sortOrder: 0,
  isActive: true,
}


const PRICING_METHOD_LABELS: Record<string, string> = {
  flat: 'flat price',
  per_unit: 'per unit',
  tiered: 'tiered',
}

// ─── Component ──────────────────────────────────────────────────

export default function OfferingDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const urlParams = useParams()
  const offeringId = (props.params?.id ?? urlParams?.id) as string
  const isNew = offeringId === 'new'

  // ─── State ──────────────────────────────────────────────────

  const [tab, setTab] = React.useState<'general' | 'charges' | 'components'>('general')
  const [form, setForm] = React.useState(EMPTY_FORM)
  const [designTimeValues, setDesignTimeValues] = React.useState<Record<string, unknown>>({})
  const [charges, setCharges] = React.useState<Charge[]>([])
  const [attributes, setAttributes] = React.useState<Attribute[]>([])
  const [specs, setSpecs] = React.useState<Specification[]>([])
  const [specDetail, setSpecDetail] = React.useState<{ id: string; code: string; name: string; specType?: string } | null>(null)
  const [pricingTables, setPricingTables] = React.useState<PricingTableRef[]>([])
  const [components, setComponents] = React.useState<OfferingComponent[]>([])
  const [bundleSlots, setBundleSlots] = React.useState<BundleSlot[]>([])
  const [addingComponent, setAddingComponent] = React.useState<{ slotId: string; childOfferingId: string; isDefault: boolean } | null>(null)
  const [slotOfferings, setSlotOfferings] = React.useState<Record<string, Array<{ id: string; code: string; name: string; offeringType: string }>>>({})

  const [loading, setLoading] = React.useState(!isNew)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [editingCharge, setEditingCharge] = React.useState<EditingCharge | null>(null)

  // OM-standard detail page: existing offerings open read-only and require
  // an explicit Edit click to allow changes. New offerings skip view mode.
  const [generalMode, setGeneralMode] = React.useState<'view' | 'edit'>(isNew ? 'edit' : 'view')
  const [formSnapshot, setFormSnapshot] = React.useState<typeof EMPTY_FORM | null>(null)
  const [designTimeSnapshot, setDesignTimeSnapshot] = React.useState<Record<string, unknown> | null>(null)

  // ─── Load data ──────────────────────────────────────────────

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // Load specs for dropdown (needed for new + showing spec name)
        const specsRes = await fetch('/api/cpq/product-specifications?pageSize=200')
        if (specsRes.ok) {
          const d = await specsRes.json()
          if (!cancelled) setSpecs(d.items ?? [])
        }

        if (isNew) return

        // Load offering detail
        const res = await fetch(`/api/cpq/product-offerings?id=${encodeURIComponent(offeringId)}`)
        if (!res.ok) {
          if (!cancelled) setError('Failed to load offering')
          return
        }

        const data: Offering = await res.json()
        if (!cancelled) {
          setForm({
            code: data.code,
            name: data.name,
            description: data.description ?? '',
            offeringType: data.offeringType ?? 'simple',
            lifecycleStatus: data.lifecycleStatus,
            effectiveFrom: data.effectiveFrom,
            effectiveTo: data.effectiveTo,
            isActive: data.isActive,
            specId: data.specId,
          })
          setDesignTimeValues(data.designTimeValues ?? {})
          setCharges(data.charges ?? [])
          setSpecDetail(data.specification ?? null)
          setComponents(data.components ?? [])

          // Load attributes for the spec
          if (data.specId) {
            const attrRes = await fetch(`/api/cpq/product-attributes?specId=${encodeURIComponent(data.specId)}&pageSize=200`)
            if (attrRes.ok) {
              const attrData = await attrRes.json()
              if (!cancelled) setAttributes(attrData.items ?? [])
            }
          }

          // Load bundle slots if this is a bundle offering
          if (data.offeringType === 'bundle' && data.specId) {
            const slotsRes = await fetch(`/api/cpq/bundle-slots?specId=${encodeURIComponent(data.specId)}`)
            if (slotsRes.ok) {
              const slotsData = await slotsRes.json()
              if (!cancelled) setBundleSlots(slotsData.items ?? [])
            }
          }
        }
      } catch (err) {
        console.error('Failed to load', err)
        if (!cancelled) setError('Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [offeringId, isNew])

  // Load attributes when spec changes (for new offering)
  const loadSpecAttributes = async (specId: string) => {
    if (!specId) { setAttributes([]); return }
    try {
      const res = await fetch(`/api/cpq/product-attributes?specId=${encodeURIComponent(specId)}&pageSize=200`)
      if (res.ok) {
        const data = await res.json()
        setAttributes(data.items ?? [])
      }
    } catch {
      console.error('Failed to load spec attributes')
    }
  }

  // ─── Save offering ─────────────────────────────────────────

  const saveOffering = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = isNew
        ? { ...form, description: form.description || null, designTimeValues, specId: form.specId }
        : { id: offeringId, ...form, description: form.description || null, designTimeValues }

      const res = await fetch('/api/cpq/product-offerings', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to save')
        return
      }

      const saved = await res.json()
      if (isNew) {
        router.push(`/backend/cpq/offerings/${saved.id}`)
      } else {
        setForm({
          code: saved.code,
          name: saved.name,
          description: saved.description ?? '',
          offeringType: saved.offeringType ?? form.offeringType,
          lifecycleStatus: saved.lifecycleStatus,
          effectiveFrom: saved.effectiveFrom,
          effectiveTo: saved.effectiveTo,
          isActive: saved.isActive,
          specId: saved.specId,
        })
        setDesignTimeValues(saved.designTimeValues ?? {})
        // Save succeeded — drop snapshots and flip back to read-only.
        setFormSnapshot(null)
        setDesignTimeSnapshot(null)
        setGeneralMode('view')
      }
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const deleteOffering = async () => {
    if (!confirm(t('cpq.offerings.confirmDelete', 'Delete this offering and all its charges?'))) return
    try {
      const res = await fetch('/api/cpq/product-offerings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: offeringId }),
      })
      if (res.ok) {
        router.push('/backend/cpq/offerings')
      } else {
        const d = await res.json()
        setError(d.error ?? 'Failed to delete')
      }
    } catch {
      setError('Failed to delete')
    }
  }

  // ─── Charge CRUD ──────────────────────────────────────────

  const loadPricingTables = async () => {
    if (pricingTables.length > 0) return
    const res = await fetch('/api/cpq/pricing-tables?pageSize=200')
    if (res.ok) {
      const data = await res.json()
      setPricingTables(data.items ?? [])
    }
  }

  const startEditCharge = (charge?: Charge) => {
    const editing = charge ? { ...charge } : { ...EMPTY_CHARGE }
    setEditingCharge(editing)
    loadPricingTables()
  }

  const saveCharge = async () => {
    if (!editingCharge) return
    setSaving(true)
    setError(null)
    try {
      const isEdit = !!editingCharge.id
      const payload = {
        ...editingCharge,
        offeringId,
      }
      const res = await fetch('/api/cpq/product-charges', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to save charge')
        return
      }
      // Reload offering to get updated charges
      const offeringRes = await fetch(`/api/cpq/product-offerings?id=${encodeURIComponent(offeringId)}`)
      if (offeringRes.ok) {
        const data = await offeringRes.json()
        setCharges(data.charges ?? [])
      }
      setEditingCharge(null)
    } catch {
      setError('Failed to save charge')
    } finally {
      setSaving(false)
    }
  }

  const deleteCharge = async (chargeId: string) => {
    if (!confirm('Delete this charge?')) return
    try {
      const res = await fetch('/api/cpq/product-charges', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chargeId }),
      })
      if (res.ok) setCharges((prev) => prev.filter((c) => c.id !== chargeId))
    } catch {
      setError('Failed to delete charge')
    }
  }

  const selectedPricingTable = editingCharge?.pricingTableId
    ? pricingTables.find((pt) => pt.id === editingCharge.pricingTableId)
    : null

  // ─── Helpers ────────────────────────────────────────────────

  const designTimeAttrs = attributes.filter((a) => a.resolutionTime === 'design_time')

  // ─── Render ─────────────────────────────────────────────────

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/backend/cpq/offerings')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {t('common.back', 'Back')}
          </button>
          <h1 className="text-2xl font-bold">
            {isNew ? t('cpq.offerings.new', 'New Offering') : form.name}
          </h1>
          {!isNew && (
            <Tag variant={lifecycleStatusMap[form.lifecycleStatus as LifecycleStatus] ?? 'neutral'} dot>
              {formatStatusLabel(form.lifecycleStatus)}
            </Tag>
          )}
          {specDetail && (
            <span className="text-sm text-muted-foreground">
              Spec: <button onClick={() => router.push(`/backend/cpq/specifications/${specDetail.id}`)} className="text-primary hover:underline">{specDetail.name}</button>
            </span>
          )}
        </div>
        {!isNew && (
          <div className="flex items-center gap-2">
            {generalMode === 'view' && tab === 'general' && (
              <Button
                type="button"
                onClick={() => {
                  setFormSnapshot(form)
                  setDesignTimeSnapshot(designTimeValues)
                  setGeneralMode('edit')
                }}
              >
                {t('common.edit', 'Edit')}
              </Button>
            )}
            <Button type="button" variant="destructive" onClick={deleteOffering}>
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">{error}</Alert>
      )}

      {/* Tabs */}
      {!isNew && (
        <div className="flex gap-1 border-b">
          {([
            'general',
            'charges',
            ...(form.offeringType === 'bundle' ? ['components' as const] : []),
          ] as const).map((t_) => (
            <button
              key={t_}
              onClick={() => setTab(t_ as typeof tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t_ ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t_ === 'general' && 'General'}
              {t_ === 'charges' && `Charges (${charges.length})`}
              {t_ === 'components' && `Components (${components.length})`}
            </button>
          ))}
        </div>
      )}

      {/* ─── General Tab / New Form ─────────────────────────────── */}
      {(isNew || tab === 'general') && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          {isNew && (
            <div>
              <label className="block text-sm font-medium mb-1">Specification</label>
              <select
                value={form.specId}
                onChange={(e) => {
                  setForm({ ...form, specId: e.target.value })
                  loadSpecAttributes(e.target.value)
                  setDesignTimeValues({})
                }}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Select a specification...</option>
                {specs.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.offerings.code', 'Code')}</label>
              {generalMode === 'view' && !isNew ? (
                <p className="text-sm font-mono py-2">{form.code || '—'}</p>
              ) : (
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="e.g. gix-cloud-connect-aws"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.offerings.name', 'Name')}</label>
              {generalMode === 'view' && !isNew ? (
                <p className="text-sm py-2">{form.name || '—'}</p>
              ) : (
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.offerings.lifecycleStatus', 'Lifecycle Status')}</label>
              {generalMode === 'view' && !isNew ? (
                <div className="py-2">
                  <Tag variant={lifecycleStatusMap[form.lifecycleStatus as LifecycleStatus] ?? 'neutral'} dot>
                    {formatStatusLabel(form.lifecycleStatus)}
                  </Tag>
                </div>
              ) : (
                <select
                  value={form.lifecycleStatus}
                  onChange={(e) => setForm({ ...form, lifecycleStatus: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="deprecated">Deprecated</option>
                  <option value="retired">Retired</option>
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.offerings.isActive', 'Is Active?')}</label>
              <div className="flex items-center h-[38px]">
                {generalMode === 'view' && !isNew ? (
                  <Tag variant={form.isActive ? 'success' : 'neutral'} dot>
                    {form.isActive ? t('common.yes', 'Yes') : t('common.no', 'No')}
                  </Tag>
                ) : (
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="rounded border"
                  />
                )}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('cpq.offerings.description', 'Description')}</label>
            {generalMode === 'view' && !isNew ? (
              <p className="text-sm text-muted-foreground py-2 whitespace-pre-wrap">{form.description || '—'}</p>
            ) : (
              <textarea
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            )}
          </div>

          {/* Design-time values */}
          {designTimeAttrs.length > 0 && (
            <div className="space-y-3">
              <label className="block text-sm font-medium">Design-Time Values</label>
              <div className="grid grid-cols-2 gap-3">
                {designTimeAttrs.map((attr) => {
                  const value = designTimeValues[attr.code]
                  const isViewing = generalMode === 'view' && !isNew
                  // Lookup the human label for select-type values so the
                  // read-only view doesn't show raw codes.
                  const optionLabel =
                    (attr.attributeType === 'select' || attr.attributeType === 'enum') && attr.options
                      ? attr.options.find((o) => o.value === value)?.label
                      : undefined
                  return (
                    <div key={attr.code}>
                      <label className="block text-xs font-medium mb-1">
                        {attr.name}
                        {attr.isRequired && <span className="text-destructive ml-0.5">*</span>}
                      </label>
                      {isViewing ? (
                        <p className="text-sm py-2">
                          {value == null || value === '' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : attr.attributeType === 'boolean' ? (
                            <Tag variant={value ? 'success' : 'neutral'} dot>
                              {value ? t('common.yes', 'Yes') : t('common.no', 'No')}
                            </Tag>
                          ) : (
                            optionLabel ?? String(value)
                          )}
                        </p>
                      ) : (attr.attributeType === 'select' || attr.attributeType === 'enum') && attr.options ? (
                        <select
                          value={String(value ?? '')}
                          onChange={(e) => setDesignTimeValues({ ...designTimeValues, [attr.code]: e.target.value || null })}
                          className="w-full rounded-md border px-2 py-1.5 text-sm"
                        >
                          <option value="">Select {attr.name}...</option>
                          {attr.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : attr.attributeType === 'number' ? (
                        <NumberInput
                          value={typeof value === 'number' ? (value as number) : null}
                          onChange={(n) => setDesignTimeValues({ ...designTimeValues, [attr.code]: n })}
                        />
                      ) : attr.attributeType === 'boolean' ? (
                        <div className="pt-1">
                          <label className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={!!value}
                              onChange={(e) => setDesignTimeValues({ ...designTimeValues, [attr.code]: e.target.checked })}
                              className="rounded border"
                            />
                            {attr.name}
                          </label>
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={String(value ?? '')}
                          onChange={(e) => setDesignTimeValues({ ...designTimeValues, [attr.code]: e.target.value || null })}
                          className="w-full rounded-md border px-2 py-1.5 text-sm"
                          placeholder={attr.helpText ?? undefined}
                        />
                      )}
                      {attr.helpText && <p className="text-xs text-muted-foreground mt-0.5">{attr.helpText}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* In view mode the Edit button lives in the page header next to
              Delete (OM standard). Here we only render the Save/Cancel
              pair when actually editing. */}
          {!(generalMode === 'view' && !isNew) && (
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={saveOffering}
                disabled={saving || !form.code || !form.name || (isNew && !form.specId)}
              >
                {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (isNew) {
                    router.push('/backend/cpq/offerings')
                    return
                  }
                  if (formSnapshot) setForm(formSnapshot)
                  if (designTimeSnapshot) setDesignTimeValues(designTimeSnapshot)
                  setFormSnapshot(null)
                  setDesignTimeSnapshot(null)
                  setGeneralMode('view')
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ─── Charges Tab ──────────────────────────────────────── */}
      {tab === 'charges' && !isNew && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => startEditCharge()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('cpq.offerings.addCharge', 'Add Charge')}
            </button>
          </div>

          {/* Charge edit form */}
          {editingCharge && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm">
                {editingCharge.id ? 'Edit Charge' : 'New Charge'}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Code</label>
                  <input type="text" value={editingCharge.code} onChange={(e) => setEditingCharge({ ...editingCharge, code: e.target.value })} placeholder="e.g. mrc-monthly" className="w-full rounded-md border px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Name</label>
                  <input type="text" value={editingCharge.name} onChange={(e) => setEditingCharge({ ...editingCharge, name: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Charge Type</label>
                  <select value={editingCharge.chargeType} onChange={(e) => setEditingCharge({ ...editingCharge, chargeType: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                    <option value="mrc">MRC (Monthly Recurring)</option>
                    <option value="nrc">NRC (Non-Recurring)</option>
                    <option value="usage">Usage</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Pricing Method</label>
                  <select value={editingCharge.pricingMethod} onChange={(e) => {
                    const method = e.target.value
                    if (method === 'flat') {
                      setEditingCharge({ ...editingCharge, pricingMethod: method, pricingTableId: null, priceColumnKey: null, quantityAttributeCode: null })
                    } else {
                      setEditingCharge({ ...editingCharge, pricingMethod: method, fixedPrice: null })
                    }
                  }} className="w-full rounded-md border px-2 py-1.5 text-sm">
                    <option value="flat">Flat Price</option>
                    <option value="per_unit">Per Unit (table lookup)</option>
                    <option value="tiered">Tiered (table lookup)</option>
                  </select>
                </div>
                {editingCharge.pricingMethod === 'flat' ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1">Fixed Price</label>
                      <input type="text" value={editingCharge.fixedPrice ?? ''} onChange={(e) => setEditingCharge({ ...editingCharge, fixedPrice: e.target.value || null })} placeholder="0.00" className="w-full rounded-md border px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Currency</label>
                      <input type="text" value={editingCharge.currencyCode ?? 'USD'} onChange={(e) => setEditingCharge({ ...editingCharge, currencyCode: e.target.value || null })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1">Pricing Table</label>
                      <select value={editingCharge.pricingTableId ?? ''} onChange={(e) => setEditingCharge({ ...editingCharge, pricingTableId: e.target.value || null, priceColumnKey: null })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                        <option value="">Select table...</option>
                        {pricingTables.map((pt) => (
                          <option key={pt.id} value={pt.id}>{pt.name} ({pt.code})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Price Column</label>
                      <select value={editingCharge.priceColumnKey ?? ''} onChange={(e) => setEditingCharge({ ...editingCharge, priceColumnKey: e.target.value || null })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                        <option value="">Select column...</option>
                        {selectedPricingTable?.priceColumns.map((col) => (
                          <option key={col.key} value={col.key}>{col.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Quantity Attribute</label>
                      <select value={editingCharge.quantityAttributeCode ?? ''} onChange={(e) => setEditingCharge({ ...editingCharge, quantityAttributeCode: e.target.value || null })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                        <option value="">Select attribute...</option>
                        {attributes.filter((a) => a.attributeType === 'number').map((a) => (
                          <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground mt-0.5">Attribute whose value drives the quantity for pricing</p>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium mb-1">Sort Order</label>
                  <NumberInput
                    integer
                    value={editingCharge.sortOrder}
                    onChange={(n) => setEditingCharge({ ...editingCharge, sortOrder: n ?? 0 })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <input type="text" value={editingCharge.description ?? ''} onChange={(e) => setEditingCharge({ ...editingCharge, description: e.target.value || null })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
              </div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={editingCharge.isActive} onChange={(e) => setEditingCharge({ ...editingCharge, isActive: e.target.checked })} className="rounded border" />
                  Active
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={saveCharge} disabled={saving || !editingCharge.code || !editingCharge.name} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingCharge(null)} className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}

          {/* Charges table */}
          {charges.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No charges defined. Add recurring, non-recurring, or usage charges to this offering.
            </div>
          ) : (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Code</th>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Pricing</th>
                    <th className="px-4 py-3 text-left font-medium">Price</th>
                    <th className="px-4 py-3 text-left font-medium">Active</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((charge) => (
                    <tr key={charge.id} className="border-b">
                      <td className="px-4 py-3 font-mono text-xs">{charge.code}</td>
                      <td className="px-4 py-3">{charge.name}</td>
                      <td className="px-4 py-3">
                        <Tag variant={chargeTypeMap[charge.chargeType as ChargeType] ?? 'neutral'} className="px-2 text-xs">
                          {charge.chargeType.toUpperCase()}
                        </Tag>
                      </td>
                      <td className="px-4 py-3 text-xs">{PRICING_METHOD_LABELS[charge.pricingMethod] ?? charge.pricingMethod}</td>
                      <td className="px-4 py-3">
                        {charge.fixedPrice != null
                          ? `${charge.currencyCode ?? 'USD'} ${charge.fixedPrice}`
                          : charge.pricingTableId
                            ? <span className="text-xs text-muted-foreground">table lookup</span>
                            : '—'}
                      </td>
                      <td className="px-4 py-3">{charge.isActive ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => startEditCharge(charge)} className="text-xs text-primary hover:underline mr-2">Edit</button>
                        <button onClick={() => deleteCharge(charge.id)} className="text-xs text-destructive hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Components Tab (bundle offerings) ────────────────────── */}
      {tab === 'components' && !isNew && form.offeringType === 'bundle' && (
        <div className="space-y-4">
          {bundleSlots.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No bundle slots defined on this specification. Add slots on the specification first.
            </div>
          ) : (
            <>
              {/* Group components by slot */}
              {bundleSlots.map((slot) => {
                const slotComponents = components.filter((c) => c.slotId === slot.id)
                return (
                  <div key={slot.id} className="rounded-lg border bg-card overflow-hidden">
                    <div className="bg-muted/50 px-4 py-3 border-b flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{slot.name}</span>
                        <Tag variant="info" className="ml-2 px-2 text-[10px]">
                          {slot.componentGroup}
                        </Tag>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {slot.cardinalityMin}..{slot.cardinalityMax ?? '∞'}
                        </span>
                        {slot.targetSpec && (
                          <span className="ml-2 text-xs text-muted-foreground">→ {slot.targetSpec.name}</span>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          setAddingComponent({ slotId: slot.id, childOfferingId: '', isDefault: false })
                          if (!slotOfferings[slot.targetSpecId]) {
                            const res = await fetch(`/api/cpq/product-offerings?specId=${encodeURIComponent(slot.targetSpecId)}&pageSize=100`)
                            if (res.ok) {
                              const d = await res.json()
                              setSlotOfferings((prev) => ({ ...prev, [slot.targetSpecId]: d.items ?? [] }))
                            }
                          }
                        }}
                        className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        + Add Component
                      </button>
                    </div>

                    {addingComponent?.slotId === slot.id && (
                      <div className="p-4 border-b bg-muted/20 space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="block text-xs font-medium mb-1">Component Offering</label>
                            <select
                              value={addingComponent.childOfferingId}
                              onChange={(e) => setAddingComponent({ ...addingComponent, childOfferingId: e.target.value })}
                              className="w-full rounded-md border px-3 py-2 text-sm"
                            >
                              <option value="">— Select offering —</option>
                              {(slotOfferings[slot.targetSpecId] ?? []).map((o) => (
                                <option key={o.id} value={o.id}>{o.name} ({o.code}){o.offeringType === 'bundle' ? ' [bundle]' : ''}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Default?</label>
                            <div className="flex items-center h-[38px]">
                              <input
                                type="checkbox"
                                checked={addingComponent.isDefault}
                                onChange={(e) => setAddingComponent({ ...addingComponent, isDefault: e.target.checked })}
                                className="rounded border"
                              />
                              <span className="ml-2 text-xs text-muted-foreground">Pre-selected in quote</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            disabled={saving || !addingComponent.childOfferingId}
                            onClick={async () => {
                              setSaving(true)
                              setError(null)
                              try {
                                const res = await fetch('/api/cpq/offering-components', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    offeringId,
                                    slotId: addingComponent.slotId,
                                    childOfferingId: addingComponent.childOfferingId,
                                    isDefault: addingComponent.isDefault,
                                  }),
                                })
                                if (!res.ok) {
                                  const d = await res.json()
                                  setError(d.error ?? 'Failed to add component')
                                  return
                                }
                                setAddingComponent(null)
                                const compRes = await fetch(`/api/cpq/offering-components?offeringId=${offeringId}`)
                                if (compRes.ok) {
                                  const d = await compRes.json()
                                  setComponents(d.items ?? [])
                                }
                              } catch {
                                setError('Failed to add component')
                              } finally {
                                setSaving(false)
                              }
                            }}
                            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {saving ? 'Adding...' : 'Add'}
                          </button>
                          <button
                            onClick={() => setAddingComponent(null)}
                            className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {slotComponents.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        No components assigned to this slot
                        {slot.cardinalityMin > 0 && (
                          <span className="ml-1 text-status-warning-text font-medium">(required: min {slot.cardinalityMin})</span>
                        )}
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="px-4 py-2 text-left text-xs font-medium">Offering</th>
                            <th className="px-4 py-2 text-left text-xs font-medium">Code</th>
                            <th className="px-4 py-2 text-left text-xs font-medium">Type</th>
                            <th className="px-4 py-2 text-left text-xs font-medium">Default</th>
                            <th className="px-4 py-2 text-right text-xs font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slotComponents.map((comp) => (
                            <tr key={comp.id} className="border-b last:border-0">
                              <td className="px-4 py-2.5 font-medium">{comp.childOffering?.name ?? 'Unknown'}</td>
                              <td className="px-4 py-2.5 text-muted-foreground text-xs">{comp.childOffering?.code ?? '—'}</td>
                              <td className="px-4 py-2.5">
                                {comp.childOffering?.offeringType === 'bundle' ? (
                                  <Tag variant="brand" className="px-2 text-[10px]">bundle</Tag>
                                ) : (
                                  <Tag variant="neutral" className="px-2 text-[10px]">simple</Tag>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <button
                                  onClick={async () => {
                                    try {
                                      const res = await fetch('/api/cpq/offering-components', {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ id: comp.id, isDefault: !comp.isDefault }),
                                      })
                                      if (res.ok) {
                                        setComponents((prev) => prev.map((c) => c.id === comp.id ? { ...c, isDefault: !c.isDefault } : c))
                                      }
                                    } catch { /* ignore */ }
                                  }}
                                  className="cursor-pointer"
                                >
                                  <Tag variant={comp.isDefault ? 'success' : 'neutral'} className="px-2 text-[10px]">
                                    {comp.isDefault ? 'Yes' : 'No'}
                                  </Tag>
                                </button>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  onClick={async () => {
                                    if (!confirm('Remove this component from the bundle?')) return
                                    try {
                                      const res = await fetch('/api/cpq/offering-components', {
                                        method: 'DELETE',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ id: comp.id }),
                                      })
                                      if (res.ok) {
                                        setComponents((prev) => prev.filter((c) => c.id !== comp.id))
                                      } else {
                                        const d = await res.json()
                                        setError(d.error ?? 'Failed to remove')
                                      }
                                    } catch {
                                      setError('Failed to remove component')
                                    }
                                  }}
                                  className="text-xs text-destructive hover:underline"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
