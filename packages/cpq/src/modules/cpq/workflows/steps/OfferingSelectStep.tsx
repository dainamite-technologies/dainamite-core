'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { WizardStepProps } from '../types'
import { NumberInput } from '../../components/NumberInput'

type Offering = {
  id: string
  code: string
  name: string
  description: string | null
  specId: string
  isActive: boolean
}

type ConstrainedAttribute = {
  code: string
  name: string
  attributeType: string
  isRequired: boolean
  options: Array<{ value: string; label: string }> | null
  constraints: Record<string, unknown> | null
  defaultValue: unknown | null
  helpText: string | null
}

type SelectedItem = {
  offering: Offering
  configuration: Record<string, unknown>
  lineId?: string
}

// ─── Inline configuration panel for a single offering ──────────

function ConfigPanel({
  offering,
  configuration,
  onChange,
  onRemove,
}: {
  offering: Offering
  configuration: Record<string, unknown>
  onChange: (code: string, value: unknown) => void
  onRemove: () => void
}) {
  const [attributes, setAttributes] = useState<ConstrainedAttribute[]>([])
  const [loading, setLoading] = useState(true)
  const [configVersion, setConfigVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ offeringId: offering.id })
        if (Object.keys(configuration).length > 0) {
          params.set('configuration', JSON.stringify(configuration))
        }
        const res = await fetch(`/api/cpq/quotes/attributes?${params}`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          const attrs = (data.attributes ?? []) as ConstrainedAttribute[]
          setAttributes(attrs.filter((a: ConstrainedAttribute & { resolutionTime?: string }) => !a.resolutionTime || a.resolutionTime === 'run_time'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [offering.id, configVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback((code: string, value: unknown) => {
    onChange(code, value)
    // Check for dependent attributes
    const hasDependents = attributes.some((a) => {
      const dep = a.constraints as Record<string, unknown> | null
      const depOn = dep?.dependsOn as { attributeCode?: string } | undefined
      const dynSrc = dep?.dynamicOptionsSource as { filterByDimension?: Record<string, string> } | undefined
      return depOn?.attributeCode === code ||
        (dynSrc?.filterByDimension && Object.values(dynSrc.filterByDimension).some((v) => v === `$${code}`))
    })
    if (hasDependents) setConfigVersion((v) => v + 1)
  }, [onChange, attributes])

  const renderAttribute = (attr: ConstrainedAttribute) => {
    const value = configuration[attr.code] ?? ''

    if (attr.attributeType === 'select' || attr.attributeType === 'enum') {
      return (
        <select value={String(value)} onChange={(e) => handleChange(attr.code, e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm">
          <option value="">Select...</option>
          {attr.options?.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      )
    }
    if (attr.attributeType === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => handleChange(attr.code, e.target.checked)} className="rounded border" />
          {attr.name}
        </label>
      )
    }
    if (attr.attributeType === 'number') {
      return (
        <NumberInput
          value={value === '' || value == null ? null : Number(value)}
          onChange={(n) => handleChange(attr.code, n ?? '')}
        />
      )
    }
    return <input type="text" value={String(value)} onChange={(e) => handleChange(attr.code, e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between border-b pb-2">
        <h4 className="text-sm font-medium">{offering.name}</h4>
        <button type="button" onClick={onRemove} className="text-xs text-muted-foreground hover:text-foreground">Remove</button>
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading attributes...</div>
      ) : attributes.length === 0 ? (
        <div className="text-sm text-muted-foreground">No configurable attributes.</div>
      ) : (
        <div className="space-y-3">
          {attributes.map((attr) => (
            <div key={attr.code}>
              <label className="block text-sm font-medium mb-1">
                {attr.name}
                {attr.isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              {renderAttribute(attr)}
              {attr.helpText && <p className="text-xs text-muted-foreground mt-1">{attr.helpText}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Port capacity indicator ─────────────────────────────────────

function BandwidthIndicator({
  portCapacityMb,
  items,
}: {
  portCapacityMb: number
  items: SelectedItem[]
}) {
  const totalBandwidth = items.reduce((sum, item) => {
    const bw = Number(item.configuration.bandwidth_mb) || 0
    return sum + bw
  }, 0)

  const pct = portCapacityMb > 0 ? Math.min(100, (totalBandwidth / portCapacityMb) * 100) : 0
  const overCapacity = totalBandwidth > portCapacityMb

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Bandwidth Utilization</span>
        <span className={overCapacity ? 'text-destructive font-medium' : 'text-muted-foreground'}>
          {totalBandwidth} / {portCapacityMb} MB
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${overCapacity ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      {overCapacity && (
        <p className="text-xs text-destructive">
          Total bandwidth exceeds port capacity by {totalBandwidth - portCapacityMb} MB
        </p>
      )}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────

const PORT_SIZE_MB: Record<string, number> = { '1G': 1000, '10G': 10000, '100G': 100000 }

export function OfferingSelectStep({ config, onComplete, onBack, stepData, currentStepId, completedSteps, quoteId, customerId }: WizardStepProps) {
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const enableConfiguration = config.enableConfiguration === true
  const multiSelect = config.multiSelect !== false // default true for offering_select
  const offeringFilter = config.offeringFilter as { specCodes?: string[]; offeringCodes?: string[] } | undefined
  const displayMode = (config.displayMode as string) ?? 'grid'

  // Resolve port capacity from prior step data
  const portCapacityMb = (() => {
    for (const data of Object.values(stepData)) {
      const cfg = data.configuration as Record<string, unknown> | undefined
      if (cfg?.port_size) return PORT_SIZE_MB[String(cfg.port_size)] ?? 0
    }
    return 0
  })()

  // Restore previous selections
  const previousData = stepData[currentStepId] as { items?: SelectedItem[] } | undefined

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        const res = await fetch(`/api/cpq/product-offerings?${params}`)
        if (res.ok) {
          const data = await res.json()
          let items = (data.items ?? []) as Offering[]
          if (offeringFilter?.offeringCodes?.length) {
            const codeOrder = offeringFilter.offeringCodes!
            items = items
              .filter((o) => codeOrder.includes(o.code))
              .sort((a, b) => codeOrder.indexOf(a.code) - codeOrder.indexOf(b.code))
          }
          items = items.filter((o) => o.isActive)
          setOfferings(items)

          // Restore previous selections
          if (previousData?.items?.length) {
            const restored = previousData.items
              .map((prev) => {
                const o = items.find((i) => i.id === prev.offering.id)
                return o ? { offering: o, configuration: prev.configuration, lineId: prev.lineId } : null
              })
              .filter(Boolean) as SelectedItem[]
            setSelectedItems(restored)
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addItem = useCallback((offering: Offering) => {
    setSelectedItems((prev) => {
      if (!multiSelect) return [{ offering, configuration: {} }]
      return [...prev, { offering, configuration: {} }]
    })
  }, [multiSelect])

  const removeItem = useCallback((index: number) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const updateItemConfig = useCallback((index: number, code: string, value: unknown) => {
    setSelectedItems((prev) => prev.map((item, i) =>
      i === index ? { ...item, configuration: { ...item.configuration, [code]: value } } : item
    ))
  }, [])

  // Resolve customerId from props or stepData
  const resolvedCustomerId = customerId ?? (() => {
    for (const data of Object.values(stepData)) {
      if (data.customerId) return data.customerId as string
    }
    return null
  })()

  const handleNext = useCallback(async () => {
    if (selectedItems.length === 0) return
    setSaving(true)
    try {
      let activeQuoteId = quoteId
      const output: Record<string, unknown> = { items: selectedItems }

      if (enableConfiguration) {
        // Auto-create quote if needed
        if (!activeQuoteId && resolvedCustomerId) {
          const createRes = await fetch('/api/cpq/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerId: resolvedCustomerId }),
          })
          if (createRes.ok) {
            const quoteData = await createRes.json()
            activeQuoteId = quoteData.id
            output.quoteId = activeQuoteId
          }
        }

        // Add or update each selected item on the quote
        if (activeQuoteId) {
          for (const item of selectedItems) {
            if (item.lineId) {
              // Update existing line
              await fetch(`/api/cpq/quotes/${activeQuoteId}/items/${item.lineId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ configuration: item.configuration }),
              })
            } else {
              // Create new line
              const res = await fetch(`/api/cpq/quotes/${activeQuoteId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ offeringId: item.offering.id, configuration: item.configuration }),
              })
              if (res.ok) {
                const data = await res.json()
                const line = data.lines?.find((l: { offeringId: string }) => l.offeringId === item.offering.id)
                item.lineId = line?.lineId
              }
            }
          }
          output.quoteId = activeQuoteId
        }
      }

      // Also set single-item compat fields
      if (selectedItems.length === 1) {
        const first = selectedItems[0]
        output.offeringId = first.offering.id
        output.offeringCode = first.offering.code
        output.offeringName = first.offering.name
        output.specId = first.offering.specId
        if (enableConfiguration) output.configuration = first.configuration
      }

      onComplete(output)
    } finally {
      setSaving(false)
    }
  }, [selectedItems, enableConfiguration, quoteId, resolvedCustomerId, onComplete])

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading offerings...</div>
  }

  // Offerings not yet added
  const availableOfferings = offerings.filter((o) =>
    multiSelect ? true : !selectedItems.some((s) => s.offering.id === o.id)
  )

  return (
    <div className="space-y-4">
      {/* Offering cards */}
      <div
        className={
          displayMode === 'grid'
            ? 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3'
            : 'flex flex-col gap-2'
        }
      >
        {availableOfferings.map((o) => {
          const isAdded = selectedItems.some((s) => s.offering.id === o.id)
          return (
            <div
              key={o.id}
              onClick={() => !isAdded && addItem(o)}
              className={`rounded-lg border-2 p-4 transition-colors ${
                isAdded
                  ? 'border-primary/30 bg-primary/5 opacity-60 cursor-default'
                  : 'border-muted cursor-pointer hover:bg-muted/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{o.name}</h4>
                {isAdded && <span className="text-xs text-primary font-medium">Added</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{o.description || o.code}</p>
              {!isAdded && (
                <span className="text-xs text-primary mt-2 inline-block">+ Add</span>
              )}
            </div>
          )
        })}
        {offerings.length === 0 && (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No offerings available.
          </div>
        )}
      </div>

      {/* Bandwidth indicator */}
      {portCapacityMb > 0 && selectedItems.length > 0 && (
        <BandwidthIndicator portCapacityMb={portCapacityMb} items={selectedItems} />
      )}

      {/* Configuration panels for selected items */}
      {enableConfiguration && selectedItems.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Selected Services ({selectedItems.length})</h4>
          {selectedItems.map((item, index) => (
            <ConfigPanel
              key={`${item.offering.id}-${index}`}
              offering={item.offering}
              configuration={item.configuration}
              onChange={(code, value) => updateItemConfig(index, code, value)}
              onRemove={() => removeItem(index)}
            />
          ))}
        </div>
      )}

      {/* No configuration — just show selected list */}
      {!enableConfiguration && selectedItems.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Selected ({selectedItems.length})</h4>
          {selectedItems.map((item, index) => (
            <div key={`${item.offering.id}-${index}`} className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm font-medium">{item.offering.name}</span>
              <button type="button" onClick={() => removeItem(index)} className="text-xs text-muted-foreground hover:text-foreground">Remove</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        {completedSteps.length > 0 && (
          <button type="button" onClick={onBack} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={selectedItems.length === 0 || saving}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Next'}
        </button>
      </div>
    </div>
  )
}
