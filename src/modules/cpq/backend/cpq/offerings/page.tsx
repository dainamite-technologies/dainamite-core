"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'

type Charge = {
  id: string
  code: string
  name: string
  description: string | null
  chargeType: string
  pricingMethod: string
  fixedPrice: string | null
  currencyCode: string | null
  isActive: boolean
}

type Offering = {
  id: string
  specId: string
  code: string
  name: string
  description: string | null
  offeringType: string
  designTimeValues: Record<string, unknown>
  lifecycleStatus: string
  isActive: boolean
  createdAt: string
}

type PricingTableRef = { id: string; code: string; name: string; priceColumns: Array<{ key: string; label: string }> }

const CHARGE_TYPE_COLORS: Record<string, string> = {
  mrc: 'bg-blue-100 text-blue-800',
  nrc: 'bg-green-100 text-green-800',
  usage: 'bg-purple-100 text-purple-800',
}

function ChargePopover({ charge }: { charge: Charge }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-default ${CHARGE_TYPE_COLORS[charge.chargeType] ?? 'bg-gray-100 text-gray-700'}`}>
        {charge.chargeType.toUpperCase()}
      </span>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 rounded-lg border bg-popover p-3 shadow-md text-popover-foreground text-xs space-y-1.5">
          <div className="font-medium text-sm">{charge.name}</div>
          <div className="text-muted-foreground font-mono">{charge.code}</div>
          {charge.description && <div className="text-muted-foreground">{charge.description}</div>}
          <div className="flex items-center justify-between pt-1 border-t">
            <span>Pricing: {charge.pricingMethod}</span>
            {charge.fixedPrice != null && (
              <span className="font-medium">{charge.currencyCode ?? 'USD'} {charge.fixedPrice}</span>
            )}
          </div>
          {!charge.isActive && <div className="text-yellow-600 font-medium">Inactive</div>}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-popover border-b border-r rotate-45 -mt-1" />
        </div>
      )}
    </span>
  )
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  deprecated: 'bg-yellow-100 text-yellow-800',
  retired: 'bg-red-100 text-red-700',
}

export default function OfferingsListPage() {
  const t = useT()
  const router = useRouter()
  const [items, setItems] = React.useState<Offering[]>([])
  const [loading, setLoading] = React.useState(true)

  // Selection & charge creation
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [chargeFormOpen, setChargeFormOpen] = React.useState(false)
  const [chargeForm, setChargeForm] = React.useState({ code: '', name: '', description: '', chargeType: 'mrc', pricingMethod: 'flat' })
  const [chargePrices, setChargePrices] = React.useState<Record<string, string>>({})
  const [chargePricingTableId, setChargePricingTableId] = React.useState<string | null>(null)
  const [chargePriceColumnKey, setChargePriceColumnKey] = React.useState<string | null>(null)
  const [chargeCurrency, setChargeCurrency] = React.useState('USD')
  const [pricingTables, setPricingTables] = React.useState<PricingTableRef[]>([])
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [offeringCharges, setOfferingCharges] = React.useState<Record<string, Charge[]>>({})

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/cpq/product-offerings?pageSize=100')
        if (res.ok) {
          const data = await res.json()
          const loadedItems: Offering[] = data.items ?? []
          if (!cancelled) setItems(loadedItems)

          // Load charges for each offering
          const results = await Promise.all(
            loadedItems.map((o) =>
              fetch(`/api/cpq/product-offerings?id=${encodeURIComponent(o.id)}`)
                .then((r) => r.ok ? r.json() : null)
            )
          )
          if (!cancelled) {
            const chargeMap: Record<string, Charge[]> = {}
            results.forEach((data, idx) => {
              if (data) chargeMap[loadedItems[idx].id] = data.charges ?? []
            })
            setOfferingCharges(chargeMap)
          }
        }
      } catch (err) {
        console.error('Failed to load offerings', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map((o) => o.id)))
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

  const openChargeForm = () => {
    setChargeForm({ code: '', name: '', description: '', chargeType: 'mrc', pricingMethod: 'flat' })
    setChargePrices({})
    setChargePricingTableId(null)
    setChargePriceColumnKey(null)
    setChargeCurrency('USD')
    setError(null)
    setChargeFormOpen(true)
    loadPricingTables()
  }

  const saveChargesForSelected = async () => {
    const targets = items.filter((o) => selectedIds.has(o.id))
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
      setSelectedIds(new Set())
      // Reload charges for affected offerings
      const reloadResults = await Promise.all(
        targets.map((o) =>
          fetch(`/api/cpq/product-offerings?id=${encodeURIComponent(o.id)}`)
            .then((r) => r.ok ? r.json() : null)
        )
      )
      setOfferingCharges((prev) => {
        const next = { ...prev }
        reloadResults.forEach((d, idx) => {
          if (d) next[targets[idx].id] = d.charges ?? []
        })
        return next
      })
    } catch {
      setError('Failed to save charges')
    } finally {
      setSaving(false)
    }
  }

  const selectedPricingTable = chargePricingTableId
    ? pricingTables.find((pt) => pt.id === chargePricingTableId)
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('cpq.offerings.list.title', 'Product Offerings')}</h1>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && !chargeFormOpen && (
            <button
              onClick={openChargeForm}
              className="inline-flex items-center justify-center rounded-md border border-primary bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20"
            >
              Add Charge to {selectedIds.size} Selected
            </button>
          )}
          <button
            onClick={() => router.push('/backend/cpq/offerings/new')}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('cpq.offerings.add', 'New Offering')}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Charge creation form */}
      {chargeFormOpen && selectedIds.size > 0 && (
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <h4 className="font-medium text-sm">New Charge for {selectedIds.size} offering{selectedIds.size > 1 ? 's' : ''}</h4>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Code</label>
              <input type="text" value={chargeForm.code} onChange={(e) => setChargeForm({ ...chargeForm, code: e.target.value })} placeholder="e.g. mrc-monthly" className="w-full rounded-md border px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Name</label>
              <input type="text" value={chargeForm.name} onChange={(e) => setChargeForm({ ...chargeForm, name: e.target.value })} placeholder="e.g. Monthly Recurring" className="w-full rounded-md border px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Type</label>
              <select value={chargeForm.chargeType} onChange={(e) => setChargeForm({ ...chargeForm, chargeType: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                <option value="nrc">NRC (Non-Recurring)</option>
                <option value="mrc">MRC (Monthly Recurring)</option>
                <option value="usage">Usage</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Pricing</label>
              <select value={chargeForm.pricingMethod} onChange={(e) => setChargeForm({ ...chargeForm, pricingMethod: e.target.value })} className="w-full rounded-md border px-2 py-1.5 text-sm">
                <option value="flat">Fixed Price (per offering)</option>
                <option value="per_unit">Per Unit (table lookup)</option>
                <option value="tiered">Tiered (table lookup)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <input type="text" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} placeholder="User-facing charge description" className="w-full rounded-md border px-2 py-1.5 text-sm" />
          </div>

          {/* Flat pricing: price per offering */}
          {chargeForm.pricingMethod === 'flat' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium">Currency</label>
                <input type="text" value={chargeCurrency} onChange={(e) => setChargeCurrency(e.target.value.toUpperCase())} maxLength={3} className="w-20 rounded-md border px-2 py-1.5 text-sm" />
              </div>
              <div className="rounded border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium text-xs">Offering</th>
                      <th className="px-3 py-2 text-left font-medium text-xs">Price ({chargeCurrency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.filter((o) => selectedIds.has(o.id)).map((o) => (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium text-xs">{o.name} <span className="text-muted-foreground font-mono">({o.code})</span></td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={chargePrices[o.id] ?? ''}
                            onChange={(e) => setChargePrices({ ...chargePrices, [o.id]: e.target.value })}
                            placeholder="0.00"
                            className="w-32 rounded-md border px-2 py-1 text-sm"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Table lookup pricing */}
          {chargeForm.pricingMethod !== 'flat' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Pricing Table</label>
                <select value={chargePricingTableId ?? ''} onChange={(e) => { setChargePricingTableId(e.target.value || null); setChargePriceColumnKey(null) }} className="w-full rounded-md border px-2 py-1.5 text-sm">
                  <option value="">Select table...</option>
                  {pricingTables.map((pt) => (
                    <option key={pt.id} value={pt.id}>{pt.name} ({pt.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Price Column</label>
                <select value={chargePriceColumnKey ?? ''} onChange={(e) => setChargePriceColumnKey(e.target.value || null)} className="w-full rounded-md border px-2 py-1.5 text-sm" disabled={!selectedPricingTable}>
                  <option value="">Select column...</option>
                  {selectedPricingTable?.priceColumns.map((col) => (
                    <option key={col.key} value={col.key}>{col.label} ({col.key})</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={saveChargesForSelected}
              disabled={saving || !chargeForm.code || !chargeForm.name}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : `Create Charge for ${selectedIds.size} Offering${selectedIds.size > 1 ? 's' : ''}`}
            </button>
            <button
              onClick={() => setChargeFormOpen(false)}
              className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('cpq.offerings.empty', 'No product offerings found. Create one to define a sellable variant of a product specification.')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={selectedIds.size === items.length && items.length > 0} onChange={toggleAll} className="rounded border" />
                </th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.offerings.code', 'Code')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.offerings.name', 'Name')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.offerings.isActive', 'Is Active?')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.offerings.lifecycleStatus', 'Lifecycle Status')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.offerings.charges', 'Charges')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('cpq.offerings.description', 'Description')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((offering) => (
                <tr
                  key={offering.id}
                  onClick={() => router.push(`/backend/cpq/offerings/${offering.id}`)}
                  className={`border-b cursor-pointer hover:bg-muted/30 transition-colors ${selectedIds.has(offering.id) ? 'bg-primary/5' : ''}`}
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(offering.id)} onChange={() => toggleSelection(offering.id)} className="rounded border" />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{offering.code}</td>
                  <td className="px-4 py-3 font-medium">
                    {offering.name}
                    {offering.offeringType === 'bundle' && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[10px] font-medium">bundle</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><input type="checkbox" checked={offering.isActive} disabled className="rounded border" /></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[offering.lifecycleStatus] ?? 'bg-gray-100 text-gray-700'}`}>
                      {offering.lifecycleStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {(offeringCharges[offering.id] ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(offeringCharges[offering.id] ?? []).map((ch) => (
                          <ChargePopover key={ch.id} charge={ch} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground truncate max-w-xs">{offering.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
