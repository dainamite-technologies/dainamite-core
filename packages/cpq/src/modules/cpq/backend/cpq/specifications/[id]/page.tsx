"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useParams, useRouter } from 'next/navigation'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { NumberInput } from '../../../../components/NumberInput'
import {
  formatStatusLabel,
  lifecycleStatusMap,
  specificationLifecycleStatusMap,
  type LifecycleStatus,
  type SpecificationLifecycleStatus,
} from '../../../../components/statusMaps'

// ─── Types ──────────────────────────────────────────────────────

type Specification = {
  id: string
  productId: string
  code: string
  name: string
  description: string | null
  specType: string
  isAssetizable: boolean
  lifecycleStatus: string
  version: number
  effectiveFrom: string | null
  effectiveTo: string | null
  metadata: Record<string, unknown> | null
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
  referenceEntity: string | null
  referenceFilter: Record<string, unknown> | null
  dependsOn: Record<string, unknown> | null
  defaultValue: unknown | null
  helpText: string | null
  sortOrder: number
  isRequired: boolean
  isActive: boolean
}

type Offering = {
  id: string
  code: string
  name: string
  description: string | null
  offeringType: string
  designTimeValues: Record<string, unknown>
  lifecycleStatus: string
  isActive: boolean
}

type BundleSlot = {
  id: string
  specId: string
  targetSpecId: string
  targetSpec: { id: string; code: string; name: string; specType: string } | null
  componentGroup: string
  name: string
  description: string | null
  cardinalityMin: number
  cardinalityMax: number | null
  sortOrder: number
  isActive: boolean
}

type EditingSlot = {
  id?: string
  targetSpecId: string
  componentGroup: string
  name: string
  description: string
  cardinalityMin: number
  cardinalityMax: number | null
  sortOrder: number
}

type Relationship = {
  id: string
  sourceSpecId: string
  targetSpecId: string
  relationshipType: string
  cardinalityMin: number
  cardinalityMax: number | null
  condition: Record<string, unknown> | null
  isActive: boolean
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

type PricingTableRef = { id: string; code: string; name: string; dimensions: Array<{ key: string; label: string }>; priceColumns: Array<{ key: string; label: string }> }

type EditingAttribute = Omit<Attribute, 'id'> & { id?: string }
type EditingOffering = Omit<Offering, 'id'> & { id?: string }
type EditingRelationship = Omit<Relationship, 'id'> & { id?: string }
type EditingCharge = Omit<Charge, 'id'> & { id?: string }

// ─── Defaults ───────────────────────────────────────────────────

const EMPTY_SPEC = {
  code: '',
  name: '',
  description: '',
  specType: 'simple' as string,
  isAssetizable: false,
  lifecycleStatus: 'draft',
  version: 1,
  effectiveFrom: null as string | null,
  effectiveTo: null as string | null,
  isActive: true,
}

const EMPTY_SLOT: EditingSlot = {
  targetSpecId: '',
  componentGroup: '',
  name: '',
  description: '',
  cardinalityMin: 0,
  cardinalityMax: null,
  sortOrder: 0,
}

const EMPTY_ATTRIBUTE: EditingAttribute = {
  code: '',
  name: '',
  attributeType: 'text',
  resolutionTime: 'run_time',
  options: null,
  constraints: null,
  referenceEntity: null,
  referenceFilter: null,
  dependsOn: null,
  defaultValue: null,
  helpText: null,
  sortOrder: 0,
  isRequired: true,
  isActive: true,
}

const EMPTY_OFFERING: EditingOffering = {
  code: '',
  name: '',
  description: null,
  offeringType: 'simple',
  designTimeValues: {},
  lifecycleStatus: 'draft',
  isActive: true,
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
  currencyCode: null,
  quantityAttributeCode: null,
  applicabilityCondition: null,
  sortOrder: 0,
  isActive: true,
}

const EMPTY_RELATIONSHIP: EditingRelationship = {
  sourceSpecId: '',
  targetSpecId: '',
  relationshipType: 'requires',
  cardinalityMin: 0,
  cardinalityMax: null,
  condition: null,
  isActive: true,
}

// ─── Component ──────────────────────────────────────────────────

export default function SpecificationDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const urlParams = useParams()
  const specId = (props.params?.id ?? urlParams?.id) as string
  const isNew = specId === 'new'

  // ─── State ──────────────────────────────────────────────────

  const [tab, setTab] = React.useState<'general' | 'attributes' | 'offerings' | 'relationships' | 'slots'>('general')
  const [form, setForm] = React.useState(EMPTY_SPEC)
  const [attributes, setAttributes] = React.useState<Attribute[]>([])
  const [offerings, setOfferings] = React.useState<Offering[]>([])
  const [relationships, setRelationships] = React.useState<Relationship[]>([])
  const [bundleSlots, setBundleSlots] = React.useState<BundleSlot[]>([])
  const [allSpecs, setAllSpecs] = React.useState<Array<{ id: string; code: string; name: string; specType?: string }>>([])

  const [loading, setLoading] = React.useState(!isNew)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [editingAttr, setEditingAttr] = React.useState<EditingAttribute | null>(null)
  const [editingOffering, setEditingOffering] = React.useState<EditingOffering | null>(null)
  const [editingRel, setEditingRel] = React.useState<EditingRelationship | null>(null)
  const [editingSlot, setEditingSlot] = React.useState<EditingSlot | null>(null)
  const [editingOptions, setEditingOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [editingDtValues, setEditingDtValues] = React.useState<Record<string, unknown>>({})
  const [selectedOfferingIds, setSelectedOfferingIds] = React.useState<Set<string>>(new Set())
  const [offeringCharges, setOfferingCharges] = React.useState<Record<string, Charge[]>>({})
  const [chargeFormOpen, setChargeFormOpen] = React.useState(false)
  const [chargeForm, setChargeForm] = React.useState({ code: '', name: '', description: '', chargeType: 'mrc', pricingMethod: 'flat' })
  const [chargePrices, setChargePrices] = React.useState<Record<string, string>>({})
  const [chargePricingTableId, setChargePricingTableId] = React.useState<string | null>(null)
  const [chargePriceColumnKey, setChargePriceColumnKey] = React.useState<string | null>(null)
  const [chargeCurrency, setChargeCurrency] = React.useState('USD')
  const [pricingTables, setPricingTables] = React.useState<PricingTableRef[]>([])
  const [conditionJson, setConditionJson] = React.useState('null')
  const [dependsOnAttrCode, setDependsOnAttrCode] = React.useState('')
  const [dependsOnEffect, setDependsOnEffect] = React.useState<string>('filter_options')
  const [dependsOnEnabled, setDependsOnEnabled] = React.useState(false)

  // ─── Load data ──────────────────────────────────────────────

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        if (isNew) {
          return
        }

        // Load all specs for relationship target selector
        const specsRes = await fetch('/api/cpq/product-specifications?pageSize=200')
        if (specsRes.ok) {
          const d = await specsRes.json()
          if (!cancelled) setAllSpecs(d.items ?? [])
        }

        // Load spec detail with nested data
        const res = await fetch(`/api/cpq/product-specifications?id=${encodeURIComponent(specId)}`)
        if (!res.ok) {
          if (!cancelled) setError('Failed to load specification')
          return
        }

        const spec = await res.json()
        if (!cancelled) {
          setForm({
            code: spec.code,
            name: spec.name,
            description: spec.description ?? '',
            specType: spec.specType ?? 'simple',
            isAssetizable: spec.isAssetizable ?? false,
            lifecycleStatus: spec.lifecycleStatus,
            version: spec.version,
            effectiveFrom: spec.effectiveFrom,
            effectiveTo: spec.effectiveTo,
            isActive: spec.isActive,
          })
          setAttributes(spec.attributes ?? [])
          setOfferings(spec.offerings ?? [])
          setRelationships(spec.relationships ?? [])
          setBundleSlots(spec.slots ?? [])
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
  }, [specId, isNew])

  // ─── Save specification ─────────────────────────────────────

  const saveSpec = async () => {
    setSaving(true)
    setError(null)
    try {
      const { ...formData } = form
      const payload = isNew
        ? { ...formData, description: formData.description || null }
        : { id: specId, ...formData, description: formData.description || null }

      const res = await fetch('/api/cpq/product-specifications', {
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
        router.push(`/backend/cpq/specifications/${saved.id}`)
      } else {
        setForm({
          code: saved.code,
          name: saved.name,
          description: saved.description ?? '',
          specType: saved.specType ?? form.specType,
          isAssetizable: saved.isAssetizable ?? form.isAssetizable,
          lifecycleStatus: saved.lifecycleStatus,
          version: saved.version,
          effectiveFrom: saved.effectiveFrom,
          effectiveTo: saved.effectiveTo,
          isActive: saved.isActive,
        })
      }
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const deleteSpec = async () => {
    if (!confirm(t('cpq.specifications.confirmDelete', 'Delete this specification and all its offerings, attributes and relationships?'))) return
    try {
      const res = await fetch('/api/cpq/product-specifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: specId }),
      })
      if (res.ok) {
        router.push('/backend/cpq/specifications')
      } else {
        const d = await res.json()
        setError(d.error ?? 'Failed to delete')
      }
    } catch {
      setError('Failed to delete')
    }
  }

  // ─── Attribute CRUD ─────────────────────────────────────────

  const saveAttribute = async () => {
    if (!editingAttr) return
    setSaving(true)
    setError(null)
    try {
      const options = (editingAttr.attributeType === 'select' || editingAttr.attributeType === 'multi-select')
        ? editingOptions.filter((o) => o.value.trim() !== '')
        : null

      const dependsOn = dependsOnEnabled && dependsOnAttrCode
        ? { attributeCode: dependsOnAttrCode, effect: dependsOnEffect, rules: [] }
        : null

      const isEdit = !!editingAttr.id
      const payload = {
        ...editingAttr,
        options,
        dependsOn,
        specId,
      }
      const res = await fetch('/api/cpq/product-attributes', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to save attribute')
        return
      }
      const saved = await res.json()
      if (isEdit) {
        setAttributes((prev) => prev.map((a) => (a.id === saved.id ? saved : a)))
      } else {
        setAttributes((prev) => [...prev, saved])
      }
      setEditingAttr(null)
    } catch {
      setError('Failed to save attribute')
    } finally {
      setSaving(false)
    }
  }

  const deleteAttribute = async (attrId: string) => {
    if (!confirm('Delete this attribute?')) return
    try {
      const res = await fetch('/api/cpq/product-attributes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: attrId }),
      })
      if (res.ok) setAttributes((prev) => prev.filter((a) => a.id !== attrId))
    } catch {
      setError('Failed to delete attribute')
    }
  }

  const startEditAttr = (attr?: Attribute) => {
    const editing = attr ? { ...attr } : { ...EMPTY_ATTRIBUTE }
    // Normalize legacy 'enum' type to 'select' for the editor
    if (editing.attributeType === 'enum') editing.attributeType = 'select'
    setEditingAttr(editing)
    setEditingOptions(editing.options ? [...editing.options] : [])
    const dep = editing.dependsOn as { attributeCode?: string; effect?: string } | null
    setDependsOnEnabled(!!dep)
    setDependsOnAttrCode(dep?.attributeCode ?? '')
    setDependsOnEffect(dep?.effect ?? 'filter_options')
  }

  // ─── Offering CRUD ──────────────────────────────────────────

  const saveOffering = async () => {
    if (!editingOffering) return
    setSaving(true)
    setError(null)
    try {
      const isEdit = !!editingOffering.id
      const payload = {
        ...editingOffering,
        designTimeValues: editingDtValues,
        specId,
      }
      const res = await fetch('/api/cpq/product-offerings', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to save offering')
        return
      }
      const saved = await res.json()
      if (isEdit) {
        setOfferings((prev) => prev.map((o) => (o.id === saved.id ? saved : o)))
      } else {
        setOfferings((prev) => [...prev, saved])
      }
      setEditingOffering(null)
    } catch {
      setError('Failed to save offering')
    } finally {
      setSaving(false)
    }
  }

  const deleteOffering = async (offeringId: string) => {
    if (!confirm('Delete this offering?')) return
    try {
      const res = await fetch('/api/cpq/product-offerings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: offeringId }),
      })
      if (res.ok) setOfferings((prev) => prev.filter((o) => o.id !== offeringId))
    } catch {
      setError('Failed to delete offering')
    }
  }

  const startEditOffering = (offering?: Offering) => {
    const editing = offering ? { ...offering } : { ...EMPTY_OFFERING }
    setEditingOffering(editing)
    setEditingDtValues(editing.designTimeValues ? { ...editing.designTimeValues } : {})
  }

  // ─── Charge management (multi-offering) ─────────────────────

  const loadAllOfferingCharges = async () => {
    try {
      const results = await Promise.all(
        offerings.map((o) => fetch(`/api/cpq/product-offerings?id=${encodeURIComponent(o.id)}`).then((r) => r.ok ? r.json() : null))
      )
      const chargeMap: Record<string, Charge[]> = {}
      results.forEach((data, idx) => {
        if (data) chargeMap[offerings[idx].id] = data.charges ?? []
      })
      setOfferingCharges(chargeMap)
    } catch {
      console.error('Failed to load charges')
    }
  }

  const loadPricingTables = async () => {
    if (pricingTables.length > 0) return
    const res = await fetch('/api/cpq/pricing-tables?pageSize=200')
    if (res.ok) {
      const data = await res.json()
      setPricingTables(data.items ?? [])
    }
  }

  const toggleOfferingSelection = (id: string) => {
    setSelectedOfferingIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAllOfferings = () => {
    if (selectedOfferingIds.size === offerings.length) {
      setSelectedOfferingIds(new Set())
    } else {
      setSelectedOfferingIds(new Set(offerings.map((o) => o.id)))
    }
  }

  const openChargeForm = () => {
    setChargeForm({ code: '', name: '', description: '', chargeType: 'mrc', pricingMethod: 'flat' })
    setChargePrices({})
    setChargePricingTableId(null)
    setChargePriceColumnKey(null)
    setChargeCurrency('USD')
    setChargeFormOpen(true)
    loadPricingTables()
  }

  const saveChargesForSelected = async () => {
    const targets = offerings.filter((o) => selectedOfferingIds.has(o.id))
    if (!targets.length || !chargeForm.code || !chargeForm.name) return
    setSaving(true)
    setError(null)
    try {
      for (const offering of targets) {
        const chargeCode = targets.length > 1 ? `${offering.code}--${chargeForm.code}` : chargeForm.code
        const payload: Record<string, unknown> = {
          offeringId: offering.id,
          code: chargeCode,
          name: chargeForm.name,
          description: chargeForm.description || null,
          chargeType: chargeForm.chargeType,
          pricingMethod: chargeForm.pricingMethod === 'flat' ? 'flat' : chargeForm.pricingMethod,
          isActive: true,
          sortOrder: 0,
        }
        if (chargeForm.pricingMethod === 'flat') {
          payload.fixedPrice = chargePrices[offering.id] || null
          payload.currencyCode = chargeCurrency
        } else {
          payload.pricingTableId = chargePricingTableId
          payload.priceColumnKey = chargePriceColumnKey
        }
        const res = await fetch('/api/cpq/product-charges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const d = await res.json()
          setError(d.error ?? `Failed to save charge for ${offering.name}`)
          break
        }
      }
      setChargeFormOpen(false)
      await loadAllOfferingCharges()
    } catch {
      setError('Failed to save charges')
    } finally {
      setSaving(false)
    }
  }

  const deleteCharge = async (offeringId: string, chargeId: string) => {
    if (!confirm('Delete this charge?')) return
    try {
      const res = await fetch('/api/cpq/product-charges', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chargeId }),
      })
      if (res.ok) {
        setOfferingCharges((prev) => ({
          ...prev,
          [offeringId]: (prev[offeringId] ?? []).filter((c) => c.id !== chargeId),
        }))
      }
    } catch {
      setError('Failed to delete charge')
    }
  }

  const selectedPricingTableRef = chargePricingTableId
    ? pricingTables.find((pt) => pt.id === chargePricingTableId)
    : null

  // ─── Relationship CRUD ──────────────────────────────────────

  const saveRelationship = async () => {
    if (!editingRel) return
    setSaving(true)
    setError(null)
    try {
      let parsedCondition = editingRel.condition
      try { parsedCondition = conditionJson === 'null' ? null : JSON.parse(conditionJson) } catch { /* keep */ }

      const isEdit = !!editingRel.id
      const payload = {
        ...editingRel,
        condition: parsedCondition,
        sourceSpecId: editingRel.sourceSpecId || specId,
      }
      const res = await fetch('/api/cpq/product-relationships', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to save relationship')
        return
      }
      const saved = await res.json()
      if (isEdit) {
        setRelationships((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))
      } else {
        setRelationships((prev) => [...prev, saved])
      }
      setEditingRel(null)
    } catch {
      setError('Failed to save relationship')
    } finally {
      setSaving(false)
    }
  }

  const deleteRelationship = async (relId: string) => {
    if (!confirm('Delete this relationship?')) return
    try {
      const res = await fetch('/api/cpq/product-relationships', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: relId }),
      })
      if (res.ok) setRelationships((prev) => prev.filter((r) => r.id !== relId))
    } catch {
      setError('Failed to delete relationship')
    }
  }

  const startEditRel = (rel?: Relationship) => {
    const editing = rel ? { ...rel } : { ...EMPTY_RELATIONSHIP, sourceSpecId: specId }
    setEditingRel(editing)
    setConditionJson(editing.condition ? JSON.stringify(editing.condition, null, 2) : 'null')
  }

  // ─── Helpers ────────────────────────────────────────────────

  const getSpecName = (id: string) => allSpecs.find((s) => s.id === id)?.name ?? id.slice(0, 8)

  // ─── Render ─────────────────────────────────────────────────

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  const designTimeAttrs = attributes.filter((a) => a.resolutionTime === 'design_time')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/backend/cpq/specifications')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {t('common.back', 'Back')}
          </button>
          <h1 className="text-2xl font-bold">
            {isNew ? t('cpq.specifications.new', 'New Specification') : form.name}
          </h1>
          {!isNew && (
            <Tag variant={specificationLifecycleStatusMap[form.lifecycleStatus as SpecificationLifecycleStatus] ?? 'neutral'} dot>
              {formatStatusLabel(form.lifecycleStatus)}
            </Tag>
          )}
        </div>
        {!isNew && (
          <Button type="button" variant="destructive" onClick={deleteSpec}>
            {t('common.delete', 'Delete')}
          </Button>
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
            'attributes',
            'offerings',
            'relationships',
            ...(form.specType === 'bundle' ? ['slots' as const] : []),
          ] as const).map((t_) => (
            <button
              key={t_}
              onClick={() => { setTab(t_ as typeof tab); if (t_ === 'offerings' && offerings.length > 0 && Object.keys(offeringCharges).length === 0) loadAllOfferingCharges() }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t_ ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t_ === 'general' && 'General'}
              {t_ === 'attributes' && `Attributes (${attributes.length})`}
              {t_ === 'offerings' && `Offerings (${offerings.length})`}
              {t_ === 'relationships' && `Relationships (${relationships.length})`}
              {t_ === 'slots' && `Bundle Slots (${bundleSlots.length})`}
            </button>
          ))}
        </div>
      )}

      {/* ─── General Tab / New Form ─────────────────────────────── */}
      {(isNew || tab === 'general') && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.specifications.code', 'Code')}</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. gix-access-port"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.specifications.name', 'Name')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.specifications.lifecycleStatus', 'Lifecycle Status')}</label>
              <select
                value={form.lifecycleStatus}
                onChange={(e) => setForm({ ...form, lifecycleStatus: e.target.value })}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="deprecated">Deprecated</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('cpq.specifications.isActive', 'Is Active?')}</label>
              <div className="flex items-center h-[38px]">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Spec Type</label>
              <select
                value={form.specType}
                onChange={(e) => setForm({ ...form, specType: e.target.value })}
                disabled={!isNew && (offerings.length > 0 || bundleSlots.length > 0)}
                className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="simple">Simple</option>
                <option value="bundle">Bundle</option>
              </select>
              {!isNew && (offerings.length > 0 || bundleSlots.length > 0) && (
                <p className="text-xs text-muted-foreground mt-1">Cannot change after offerings or slots exist</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Is Assetizable?</label>
              <div className="flex items-center h-[38px]">
                <input
                  type="checkbox"
                  checked={form.isAssetizable}
                  onChange={(e) => setForm({ ...form, isAssetizable: e.target.checked })}
                  className="rounded border"
                />
                <span className="ml-2 text-xs text-muted-foreground">Creates asset records during fulfilment</span>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('cpq.specifications.description', 'Description')}</label>
            <textarea
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          {!isNew && (
            <span className="text-xs text-muted-foreground">Version {form.version}</span>
          )}
          <div className="flex gap-3">
            <button
              onClick={saveSpec}
              disabled={saving || !form.code || !form.name}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </button>
            <button
              onClick={() => router.push('/backend/cpq/specifications')}
              className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ─── Attributes Tab ─────────────────────────────────────── */}
      {tab === 'attributes' && !isNew && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => startEditAttr()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('cpq.specifications.addAttribute', 'Add Attribute')}
            </button>
          </div>

          {editingAttr && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm">
                {editingAttr.id ? 'Edit Attribute' : 'New Attribute'}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Code</label>
                  <input type="text" value={editingAttr.code} onChange={(e) => setEditingAttr({ ...editingAttr, code: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Name</label>
                  <input type="text" value={editingAttr.name} onChange={(e) => setEditingAttr({ ...editingAttr, name: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Type</label>
                  <select value={editingAttr.attributeType} onChange={(e) => setEditingAttr({ ...editingAttr, attributeType: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="select">Select</option>
                    <option value="multi-select">Multi-Select</option>
                    <option value="reference">Reference</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Resolution Time</label>
                  <select value={editingAttr.resolutionTime} onChange={(e) => setEditingAttr({ ...editingAttr, resolutionTime: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                    <option value="run_time">Run-time (quoting)</option>
                    <option value="design_time">Design-time (offering)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Sort Order</label>
                  <NumberInput
                    integer
                    value={editingAttr.sortOrder}
                    onChange={(n) => setEditingAttr({ ...editingAttr, sortOrder: n ?? 0 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Help Text</label>
                  <input type="text" value={editingAttr.helpText ?? ''} onChange={(e) => setEditingAttr({ ...editingAttr, helpText: e.target.value || null })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
                </div>
                {editingAttr.attributeType === 'reference' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1">Reference Entity</label>
                      <input type="text" value={editingAttr.referenceEntity ?? ''} onChange={(e) => setEditingAttr({ ...editingAttr, referenceEntity: e.target.value || null })} placeholder="e.g. CatalogProduct" className="w-full rounded-md border px-2 py-1.5 text-sm" />
                    </div>
                  </>
                )}
                {(editingAttr.attributeType === 'select' || editingAttr.attributeType === 'multi-select') && (
                  <div className="col-span-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium">Options</label>
                      <button
                        type="button"
                        onClick={() => setEditingOptions([...editingOptions, { value: '', label: '' }])}
                        className="text-xs text-primary hover:underline"
                      >
                        + Add option
                      </button>
                    </div>
                    {editingOptions.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-2">No options defined. Click &quot;Add option&quot; to start.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {editingOptions.map((opt, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={opt.value}
                              onChange={(e) => {
                                const next = [...editingOptions]
                                next[idx] = { ...next[idx], value: e.target.value }
                                setEditingOptions(next)
                              }}
                              placeholder="Value (e.g. aws)"
                              className="flex-1 rounded-md border px-2 py-1.5 text-sm"
                            />
                            <input
                              type="text"
                              value={opt.label}
                              onChange={(e) => {
                                const next = [...editingOptions]
                                next[idx] = { ...next[idx], label: e.target.value }
                                setEditingOptions(next)
                              }}
                              placeholder="Label (e.g. Amazon Web Services)"
                              className="flex-1 rounded-md border px-2 py-1.5 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => setEditingOptions(editingOptions.filter((_, i) => i !== idx))}
                              className="text-destructive hover:text-destructive/80 text-sm px-1"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="col-span-3 space-y-2">
                  <label className="flex items-center gap-1.5 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={dependsOnEnabled}
                      onChange={(e) => setDependsOnEnabled(e.target.checked)}
                      className="rounded border"
                    />
                    Depends on another attribute
                  </label>
                  {dependsOnEnabled && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Parent Attribute Code</label>
                        <select
                          value={dependsOnAttrCode}
                          onChange={(e) => setDependsOnAttrCode(e.target.value)}
                          className="w-full rounded-md border px-2 py-1.5 text-sm"
                        >
                          <option value="">Select attribute...</option>
                          {attributes.filter((a) => editingAttr && a.code !== editingAttr.code).map((a) => (
                            <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Effect</label>
                        <select
                          value={dependsOnEffect}
                          onChange={(e) => setDependsOnEffect(e.target.value)}
                          className="w-full rounded-md border px-2 py-1.5 text-sm"
                        >
                          <option value="filter_options">Filter options</option>
                          <option value="set_value">Set value</option>
                          <option value="toggle_required">Toggle required</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={editingAttr.isRequired} onChange={(e) => setEditingAttr({ ...editingAttr, isRequired: e.target.checked })} className="rounded border" />
                    Required
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={editingAttr.isActive} onChange={(e) => setEditingAttr({ ...editingAttr, isActive: e.target.checked })} className="rounded border" />
                    Active
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveAttribute} disabled={saving} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingAttr(null)} className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}

          {attributes.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No attributes defined. Add design-time and run-time attributes for this specification.
            </div>
          ) : (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Code</th>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Resolution</th>
                    <th className="px-4 py-3 text-left font-medium">Options</th>
                    <th className="px-4 py-3 text-left font-medium">Required</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attributes.map((attr) => (
                    <tr key={attr.id} className="border-b">
                      <td className="px-4 py-3 font-mono text-xs">{attr.code}</td>
                      <td className="px-4 py-3">{attr.name}</td>
                      <td className="px-4 py-3">{attr.attributeType}</td>
                      <td className="px-4 py-3">
                        <Tag variant={attr.resolutionTime === 'design_time' ? 'info' : 'neutral'} className="px-2 text-xs">
                          {attr.resolutionTime === 'design_time' ? 'design' : 'run'}
                        </Tag>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{attr.options ? `${attr.options.length} options` : '—'}</td>
                      <td className="px-4 py-3">{attr.isRequired ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => startEditAttr(attr)} className="text-xs text-primary hover:underline mr-2">Edit</button>
                        <button onClick={() => deleteAttribute(attr.id)} className="text-xs text-destructive hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Offerings Tab ──────────────────────────────────────── */}
      {tab === 'offerings' && !isNew && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => startEditOffering()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('cpq.specifications.addOffering', 'Add Offering')}
            </button>
          </div>

          {editingOffering && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm">
                {editingOffering.id ? 'Edit Offering' : 'New Offering'}
              </h3>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Code</label>
                  <input type="text" value={editingOffering.code} onChange={(e) => setEditingOffering({ ...editingOffering, code: e.target.value })} placeholder="e.g. gix-cloud-connect-aws" className="w-full rounded-md border px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Name</label>
                  <input type="text" value={editingOffering.name} onChange={(e) => setEditingOffering({ ...editingOffering, name: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Lifecycle Status</label>
                  <select value={editingOffering.lifecycleStatus} onChange={(e) => setEditingOffering({ ...editingOffering, lifecycleStatus: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="deprecated">Deprecated</option>
                    <option value="retired">Retired</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Is Active?</label>
                  <div className="flex items-center h-[30px]">
                    <input type="checkbox" checked={editingOffering.isActive} onChange={(e) => setEditingOffering({ ...editingOffering, isActive: e.target.checked })} className="rounded border" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <input type="text" value={editingOffering.description ?? ''} onChange={(e) => setEditingOffering({ ...editingOffering, description: e.target.value || null })} className="w-full rounded-md border px-2 py-1.5 text-sm" />
              </div>
              {designTimeAttrs.length > 0 ? (
                <div className="space-y-3">
                  <label className="block text-xs font-medium">Design-Time Values</label>
                  <div className="grid grid-cols-2 gap-3">
                    {designTimeAttrs.map((attr) => (
                      <div key={attr.code}>
                        <label className="block text-xs font-medium mb-1">
                          {attr.name}
                          {attr.isRequired && <span className="text-destructive ml-0.5">*</span>}
                        </label>
                        {(attr.attributeType === 'select' || attr.attributeType === 'enum') && attr.options ? (
                          <select
                            value={String(editingDtValues[attr.code] ?? '')}
                            onChange={(e) => setEditingDtValues({ ...editingDtValues, [attr.code]: e.target.value || null })}
                            className="w-full rounded-md border px-2 py-1.5 text-sm"
                          >
                            <option value="">Select {attr.name}...</option>
                            {attr.options.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : attr.attributeType === 'number' ? (
                          <NumberInput
                            value={typeof editingDtValues[attr.code] === 'number' ? (editingDtValues[attr.code] as number) : null}
                            onChange={(n) => setEditingDtValues({ ...editingDtValues, [attr.code]: n })}
                          />
                        ) : attr.attributeType === 'boolean' ? (
                          <div className="pt-1">
                            <label className="flex items-center gap-1.5 text-sm">
                              <input
                                type="checkbox"
                                checked={!!editingDtValues[attr.code]}
                                onChange={(e) => setEditingDtValues({ ...editingDtValues, [attr.code]: e.target.checked })}
                                className="rounded border"
                              />
                              {attr.name}
                            </label>
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={String(editingDtValues[attr.code] ?? '')}
                            onChange={(e) => setEditingDtValues({ ...editingDtValues, [attr.code]: e.target.value || null })}
                            className="w-full rounded-md border px-2 py-1.5 text-sm"
                            placeholder={attr.helpText ?? undefined}
                          />
                        )}
                        {attr.helpText && <p className="text-xs text-muted-foreground mt-0.5">{attr.helpText}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-1">
                  No design-time attributes defined on this specification. All attributes are run-time.
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={saveOffering} disabled={saving} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingOffering(null)} className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}

          {offerings.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No offerings created. An offering is a sellable instance of this specification with fixed design-time values and attached charges.
            </div>
          ) : (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-3 text-left font-medium">Code</th>
                    <th className="px-3 py-3 text-left font-medium">Name</th>
                    <th className="px-3 py-3 text-left font-medium">Status</th>
                    <th className="px-3 py-3 text-left font-medium">Design-Time Values</th>
                    <th className="px-3 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {offerings.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => router.push(`/backend/cpq/offerings/${o.id}`)}
                      className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-3 font-mono text-xs">{o.code}</td>
                      <td className="px-3 py-3 font-medium">{o.name}</td>
                      <td className="px-3 py-3">
                        <Tag variant={lifecycleStatusMap[o.lifecycleStatus as LifecycleStatus] ?? 'neutral'} dot>
                          {formatStatusLabel(o.lifecycleStatus)}
                        </Tag>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-xs">
                        {Object.keys(o.designTimeValues).length > 0
                          ? Object.entries(o.designTimeValues).map(([k, v]) => `${k}=${v}`).join(', ')
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); startEditOffering(o) }} className="text-xs text-primary hover:underline mr-2">Edit</button>
                        <button onClick={(e) => { e.stopPropagation(); deleteOffering(o.id) }} className="text-xs text-destructive hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Relationships Tab ──────────────────────────────────── */}
      {tab === 'relationships' && !isNew && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => startEditRel()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('cpq.specifications.addRelationship', 'Add Relationship')}
            </button>
          </div>

          {editingRel && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h3 className="font-medium text-sm">
                {editingRel.id ? 'Edit Relationship' : 'New Relationship'}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Type</label>
                  <select value={editingRel.relationshipType} onChange={(e) => setEditingRel({ ...editingRel, relationshipType: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                    <option value="parent_child">Parent / Child</option>
                    <option value="requires">Requires</option>
                    <option value="excludes">Excludes</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Target Specification</label>
                  <select value={editingRel.targetSpecId} onChange={(e) => setEditingRel({ ...editingRel, targetSpecId: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                    <option value="">Select...</option>
                    {allSpecs.filter((s) => s.id !== specId).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Min</label>
                    <NumberInput
                      integer
                      min={0}
                      value={editingRel.cardinalityMin}
                      onChange={(n) => setEditingRel({ ...editingRel, cardinalityMin: n ?? 0 })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Max</label>
                    <NumberInput
                      integer
                      min={0}
                      value={editingRel.cardinalityMax}
                      onChange={(n) => setEditingRel({ ...editingRel, cardinalityMax: n })}
                      placeholder="∞"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Condition (JSON)</label>
                <textarea value={conditionJson} onChange={(e) => setConditionJson(e.target.value)} rows={3} className="w-full rounded-md border px-2 py-1.5 text-sm font-mono" placeholder='null or {"attribute":"direction","operator":"in","value":["inbound"]}' />
              </div>
              <div className="flex gap-2">
                <button onClick={saveRelationship} disabled={saving} className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingRel(null)} className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}

          {relationships.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No relationships defined. Declare parent/child, requires, or excludes relationships with other specifications.
            </div>
          ) : (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-left font-medium">Target</th>
                    <th className="px-4 py-3 text-left font-medium">Cardinality</th>
                    <th className="px-4 py-3 text-left font-medium">Condition</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((rel) => (
                    <tr key={rel.id} className="border-b">
                      <td className="px-4 py-3">
                        <Tag
                          variant={
                            rel.relationshipType === 'parent_child' ? 'brand' :
                            rel.relationshipType === 'requires' ? 'info' :
                            'error'
                          }
                        >
                          {rel.relationshipType}
                        </Tag>
                      </td>
                      <td className="px-4 py-3 text-sm">{getSpecName(rel.sourceSpecId)}</td>
                      <td className="px-4 py-3 text-sm">{getSpecName(rel.targetSpecId)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{rel.cardinalityMin}..{rel.cardinalityMax ?? '∞'}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{rel.condition ? JSON.stringify(rel.condition) : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => startEditRel(rel)} className="text-xs text-primary hover:underline mr-2">Edit</button>
                        <button onClick={() => deleteRelationship(rel.id)} className="text-xs text-destructive hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Bundle Slots Tab ──────────────────────────────────── */}
      {tab === 'slots' && !isNew && form.specType === 'bundle' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setEditingSlot({ ...EMPTY_SLOT })}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              + Add Slot
            </button>
          </div>

          {editingSlot && (
            <div className="rounded-lg border bg-card p-6 space-y-4">
              <h3 className="text-sm font-semibold">{editingSlot.id ? 'Edit Bundle Slot' : 'New Bundle Slot'}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={editingSlot.name}
                    onChange={(e) => setEditingSlot({ ...editingSlot, name: e.target.value })}
                    placeholder="e.g. Internet Component"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Component Group</label>
                  <input
                    type="text"
                    value={editingSlot.componentGroup}
                    onChange={(e) => setEditingSlot({ ...editingSlot, componentGroup: e.target.value })}
                    placeholder="e.g. internet, tv, phone"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Target Specification</label>
                  <select
                    value={editingSlot.targetSpecId}
                    onChange={(e) => setEditingSlot({ ...editingSlot, targetSpecId: e.target.value })}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    <option value="">— Select specification —</option>
                    {allSpecs.filter((s) => s.id !== specId).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Sort Order</label>
                  <NumberInput
                    integer
                    value={editingSlot.sortOrder}
                    onChange={(n) => setEditingSlot({ ...editingSlot, sortOrder: n ?? 0 })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cardinality Min</label>
                  <NumberInput
                    integer
                    min={0}
                    value={editingSlot.cardinalityMin}
                    onChange={(n) => setEditingSlot({ ...editingSlot, cardinalityMin: n ?? 0 })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cardinality Max</label>
                  <NumberInput
                    integer
                    min={0}
                    placeholder="∞ (unlimited)"
                    value={editingSlot.cardinalityMax}
                    onChange={(n) => setEditingSlot({ ...editingSlot, cardinalityMax: n })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={editingSlot.description ?? ''}
                  onChange={(e) => setEditingSlot({ ...editingSlot, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setSaving(true)
                    setError(null)
                    try {
                      const isEdit = !!editingSlot.id
                      const payload = isEdit
                        ? { id: editingSlot.id, ...editingSlot, description: editingSlot.description || null }
                        : { specId, ...editingSlot, description: editingSlot.description || null }
                      const res = await fetch('/api/cpq/bundle-slots', {
                        method: isEdit ? 'PUT' : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      })
                      if (!res.ok) {
                        const d = await res.json()
                        setError(d.error ?? 'Failed to save slot')
                        return
                      }
                      setEditingSlot(null)
                      const slotsRes = await fetch(`/api/cpq/bundle-slots?specId=${specId}`)
                      if (slotsRes.ok) {
                        const d = await slotsRes.json()
                        setBundleSlots(d.items ?? [])
                      }
                    } catch {
                      setError('Failed to save slot')
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving || !editingSlot.name || !editingSlot.componentGroup || !editingSlot.targetSpecId}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : (editingSlot.id ? 'Update' : 'Create')}
                </button>
                <button
                  onClick={() => setEditingSlot(null)}
                  className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {bundleSlots.length === 0 && !editingSlot ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No bundle slots defined yet. Add slots to define what component specifications can fill this bundle.
            </div>
          ) : bundleSlots.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Group</th>
                    <th className="px-4 py-3 text-left font-medium">Target Spec</th>
                    <th className="px-4 py-3 text-left font-medium">Cardinality</th>
                    <th className="px-4 py-3 text-left font-medium">Order</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bundleSlots.map((slot) => (
                    <tr key={slot.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{slot.name}</td>
                      <td className="px-4 py-3">
                        <Tag variant="info">{slot.componentGroup}</Tag>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {slot.targetSpec ? (
                          <span>
                            {slot.targetSpec.name}
                            {slot.targetSpec.specType === 'bundle' && (
                              <Tag variant="brand" className="ml-1 px-1.5 text-[10px]">bundle</Tag>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{slot.cardinalityMin}..{slot.cardinalityMax ?? '∞'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{slot.sortOrder}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditingSlot({
                            id: slot.id,
                            targetSpecId: slot.targetSpecId,
                            componentGroup: slot.componentGroup,
                            name: slot.name,
                            description: slot.description ?? '',
                            cardinalityMin: slot.cardinalityMin,
                            cardinalityMax: slot.cardinalityMax,
                            sortOrder: slot.sortOrder,
                          })}
                          className="text-xs text-primary hover:underline mr-2"
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this bundle slot?')) return
                            try {
                              const res = await fetch('/api/cpq/bundle-slots', {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: slot.id }),
                              })
                              if (res.ok) {
                                setBundleSlots((prev) => prev.filter((s) => s.id !== slot.id))
                              } else {
                                const d = await res.json()
                                setError(d.error ?? 'Failed to delete slot')
                              }
                            } catch {
                              setError('Failed to delete slot')
                            }
                          }}
                          className="text-xs text-destructive hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
