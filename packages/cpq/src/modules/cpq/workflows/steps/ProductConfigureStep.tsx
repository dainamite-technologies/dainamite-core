'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { WizardStepProps } from '../types'

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

type AttributeGroup = {
  label: string
  attributeCodes: string[]
}

function resolveOfferingId(config: Record<string, unknown>, stepData: Record<string, Record<string, unknown>>): string | null {
  // Check explicit source
  const source = config.offeringSource as string | undefined
  if (source && stepData[source]) {
    return (stepData[source].offeringId as string) ?? null
  }
  // Auto-detect: find first step data with offeringId
  for (const data of Object.values(stepData)) {
    if (data.offeringId) return data.offeringId as string
  }
  return null
}

export function ProductConfigureStep({ config, onComplete, onBack, stepData, currentStepId, completedSteps, quoteId, customerId }: WizardStepProps) {
  const [attributes, setAttributes] = useState<ConstrainedAttribute[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resolvedOfferingId, setResolvedOfferingId] = useState<string | null>(null)

  const directOfferingId = resolveOfferingId(config, stepData)
  const offeringCode = config.offeringCode as string | undefined
  const attributeGroups = config.attributeGroups as AttributeGroup[] | undefined

  // Resolve offering by code if no direct offeringId
  useEffect(() => {
    if (directOfferingId) {
      setResolvedOfferingId(directOfferingId)
      return
    }
    if (!offeringCode) return
    async function resolve() {
      try {
        const res = await fetch(`/api/cpq/product-offerings?code=${encodeURIComponent(offeringCode!)}`)
        if (res.ok) {
          const data = await res.json()
          const items = data.items ?? data
          if (Array.isArray(items) && items.length > 0) {
            setResolvedOfferingId(items[0].id)
          }
        }
      } catch { /* ignore */ }
    }
    resolve()
  }, [directOfferingId, offeringCode])

  const offeringId = resolvedOfferingId
  const hiddenAttributes = (config.hiddenAttributes as string[]) ?? []
  const readonlyAttributes = (config.readonlyAttributes as string[]) ?? []

  // Restore previous values
  const previousData = stepData[currentStepId] as { configuration?: Record<string, unknown> } | undefined

  useEffect(() => {
    async function loadAttributes() {
      if (!offeringId) { setLoading(false); return }
      setLoading(true)
      try {
        const params = new URLSearchParams({ offeringId })
        if (Object.keys(values).length > 0) {
          params.set('configuration', JSON.stringify(values))
        }
        const res = await fetch(`/api/cpq/quotes/attributes?${params}`)
        if (res.ok) {
          const data = await res.json()
          const attrs = (data.attributes ?? []) as ConstrainedAttribute[]
          setAttributes(attrs.filter((a) => !hiddenAttributes.includes(a.code)))

          // Set defaults on first load
          if (Object.keys(values).length === 0) {
            const defaults: Record<string, unknown> = previousData?.configuration ?? {}
            for (const attr of attrs) {
              if (defaults[attr.code] === undefined && attr.defaultValue != null) {
                defaults[attr.code] = attr.defaultValue
              }
            }
            setValues(defaults)
          }
        }
      } finally {
        setLoading(false)
      }
    }
    loadAttributes()
  }, [offeringId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback((code: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [code]: value }))
  }, [])

  // Resolve customerId from props or stepData
  const resolvedCustomerId = customerId ?? (() => {
    for (const data of Object.values(stepData)) {
      if (data.customerId) return data.customerId as string
    }
    return null
  })()

  const handleComplete = useCallback(async () => {
    setSaving(true)
    try {
      let activeQuoteId = quoteId

      // Auto-create a quote if none exists yet
      if (!activeQuoteId && resolvedCustomerId && offeringId) {
        const createRes = await fetch('/api/cpq/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: resolvedCustomerId }),
        })
        if (createRes.ok) {
          const quoteData = await createRes.json()
          activeQuoteId = quoteData.id
        }
      }

      if (activeQuoteId && offeringId) {
        // Check if there's already a line for this offering
        const existingLineId = (stepData[currentStepId] as { lineId?: string })?.lineId

        if (existingLineId) {
          await fetch(`/api/cpq/quotes/${activeQuoteId}/items/${existingLineId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configuration: values }),
          })
          onComplete({ configuration: values, offeringId, lineId: existingLineId, quoteId: activeQuoteId })
        } else {
          const res = await fetch(`/api/cpq/quotes/${activeQuoteId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offeringId, configuration: values }),
          })
          if (res.ok) {
            const data = await res.json()
            const line = data.lines?.find((l: { offeringId: string }) => l.offeringId === offeringId)
            onComplete({ configuration: values, offeringId, lineId: line?.lineId, quoteId: activeQuoteId })
          } else {
            onComplete({ configuration: values, offeringId, quoteId: activeQuoteId })
          }
        }
      } else {
        onComplete({ configuration: values, offeringId })
      }
    } finally {
      setSaving(false)
    }
  }, [values, quoteId, offeringId, stepData, currentStepId, onComplete, resolvedCustomerId])

  const renderAttribute = (attr: ConstrainedAttribute) => {
    const isReadonly = readonlyAttributes.includes(attr.code)
    const value = values[attr.code] ?? ''

    if (attr.attributeType === 'select' || attr.attributeType === 'enum') {
      return (
        <select
          value={String(value)}
          onChange={(e) => handleChange(attr.code, e.target.value)}
          disabled={isReadonly}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="">Select...</option>
          {attr.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )
    }

    if (attr.attributeType === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => handleChange(attr.code, e.target.checked)}
            disabled={isReadonly}
            className="rounded border"
          />
          {attr.name}
        </label>
      )
    }

    if (attr.attributeType === 'number') {
      return (
        <input
          type="number"
          value={value === '' ? '' : Number(value)}
          onChange={(e) => handleChange(attr.code, e.target.value ? Number(e.target.value) : '')}
          disabled={isReadonly}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        />
      )
    }

    return (
      <input
        type="text"
        value={String(value)}
        onChange={(e) => handleChange(attr.code, e.target.value)}
        disabled={isReadonly}
        className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
      />
    )
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading attributes...</div>
  }

  if (!offeringId) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No offering selected. Please go back and select an offering.
      </div>
    )
  }

  const renderGroup = (label: string, attrs: ConstrainedAttribute[]) => (
    <div key={label} className="space-y-3">
      <h4 className="text-sm font-medium border-b pb-2">{label}</h4>
      <div className="space-y-3">
        {attrs.map((attr) => (
          <div key={attr.code}>
            <label className="block text-sm font-medium mb-1">
              {attr.name}
              {attr.isRequired && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {renderAttribute(attr)}
            {attr.helpText && <p className="text-xs text-muted-foreground mt-1">{attr.helpText}</p>}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {attributeGroups?.length ? (
        attributeGroups.map((group) => {
          const groupAttrs = attributes.filter((a) => group.attributeCodes.includes(a.code))
          if (groupAttrs.length === 0) return null
          return renderGroup(group.label, groupAttrs)
        })
      ) : (
        renderGroup('Configuration', attributes)
      )}

      <div className="flex gap-2 justify-end pt-2">
        {completedSteps.length > 0 && (
          <button type="button" onClick={onBack} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleComplete}
          disabled={saving}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Next'}
        </button>
      </div>
    </div>
  )
}
