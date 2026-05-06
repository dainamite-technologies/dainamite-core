'use client'

import * as React from 'react'
import type { PublicOffering, PublicSpecification } from '../../types'

type Attribute = {
  code: string
  name: string
  attributeType: string
  resolutionTime?: string
  isRequired?: boolean
  options?: Array<{ value: string; label: string }> | null
  constraints?: Record<string, unknown> | null
  defaultValue?: unknown
  helpText?: string | null
}

type Props = {
  offering: PublicOffering
  specification: PublicSpecification
  configuration: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}

const ATTRIBUTES_ENDPOINT = '/api/demo_puffin/cloud-pricing-calculator/attributes'

/**
 * Renders run-time attribute inputs for an offering by calling the public
 * `/attributes` proxy. Inputs adapt to the attribute type:
 *   - enum / select / multi-select  → dropdown
 *   - boolean                       → checkbox
 *   - number                        → numeric input (slider when min/max)
 *   - text                          → text input
 */
export function GenericConfigurator({ offering, specification, configuration, onChange }: Props) {
  const [attrs, setAttrs] = React.useState<Attribute[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const lastConfigRef = React.useRef<string>('')

  // Refresh attributes when configuration changes affect any dependency.
  const dependencyKey = React.useMemo(() => {
    const keysWithDependents = attrs.filter((a) => {
      const cons = a.constraints as Record<string, unknown> | undefined
      const dep = cons?.dependsOn as { attributeCode?: string } | undefined
      return Boolean(dep?.attributeCode)
    }).map((a) => a.code)
    return JSON.stringify(keysWithDependents.map((k) => configuration[k]))
  }, [attrs, configuration])

  const refreshAttrs = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(ATTRIBUTES_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offeringId: offering.id, configuration }),
      })
      // Many simple offerings (free tiers, support plans) have no run-time
      // attributes — the upstream resolver may 404 / 422 / 500. Treat any
      // non-200 as "no attributes needed" so the visitor isn't blocked by a
      // red error on an offering that's already fully configured at design
      // time.
      if (!res.ok) {
        setAttrs([])
        return
      }
      const data = (await res.json()) as { attributes: Attribute[] }
      setAttrs(data.attributes ?? [])
    } catch {
      setError('network_error')
    } finally {
      setLoading(false)
    }
  }, [offering.id, configuration])

  React.useEffect(() => {
    void refreshAttrs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offering.id, version])

  // When a dependency value changes, re-fetch options.
  React.useEffect(() => {
    if (dependencyKey === lastConfigRef.current) return
    lastConfigRef.current = dependencyKey
    if (attrs.length > 0) setVersion((v) => v + 1)
  }, [dependencyKey, attrs.length])

  if (loading && attrs.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading options…</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">Could not load options. Refresh the page.</p>
  }
  if (attrs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No additional configuration needed.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {attrs.map((attr) => (
        <AttributeField
          key={attr.code}
          attr={attr}
          value={configuration[attr.code]}
          onChange={(value) => onChange({ [attr.code]: value })}
        />
      ))}
      <p className="text-[11px] text-muted-foreground">
        From spec: <span className="font-mono">{specification.code}</span>
      </p>
    </div>
  )
}

function AttributeField({
  attr,
  value,
  onChange,
}: {
  attr: Attribute
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = `attr-${attr.code}`
  const helpText = attr.helpText ?? undefined

  if (attr.attributeType === 'boolean') {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-input"
        />
        <span>{attr.name}</span>
        {attr.isRequired && <span className="text-destructive">*</span>}
        {helpText && <span className="text-xs text-muted-foreground">{helpText}</span>}
      </label>
    )
  }

  if (attr.attributeType === 'number') {
    const cons = (attr.constraints ?? {}) as { min?: number; max?: number; step?: number }
    const numericValue = typeof value === 'number' ? value : Number(value ?? attr.defaultValue ?? cons.min ?? 0)
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium flex items-center gap-1">
          {attr.name}
          {attr.isRequired && <span className="text-destructive">*</span>}
          <span className="ml-auto text-xs text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {numericValue}
          </span>
        </label>
        <input
          id={id}
          type={cons.min != null && cons.max != null ? 'range' : 'number'}
          min={cons.min}
          max={cons.max}
          step={cons.step ?? 1}
          value={Number.isFinite(numericValue) ? numericValue : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
        {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
      </div>
    )
  }

  // enum, select, multi-select, reference
  const options = attr.options ?? []
  if (options.length === 0) {
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium flex items-center gap-1">
          {attr.name}
          {attr.isRequired && <span className="text-destructive">*</span>}
        </label>
        <input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
        />
        {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium flex items-center gap-1">
        {attr.name}
        {attr.isRequired && <span className="text-destructive">*</span>}
      </label>
      <select
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-2 py-1 text-sm"
      >
        <option value="">— Select —</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  )
}
