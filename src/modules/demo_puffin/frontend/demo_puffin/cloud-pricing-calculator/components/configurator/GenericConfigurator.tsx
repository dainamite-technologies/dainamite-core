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

  React.useEffect(() => {
    if (dependencyKey === lastConfigRef.current) return
    lastConfigRef.current = dependencyKey
    if (attrs.length > 0) setVersion((v) => v + 1)
  }, [dependencyKey, attrs.length])

  if (loading && attrs.length === 0) {
    return <p className="pf-config-help">Loading options…</p>
  }
  if (error) {
    return <p className="pf-cart-error">Could not load options. Refresh the page.</p>
  }
  if (attrs.length === 0) {
    return <p className="pf-config-help">No additional configuration needed.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="pf-config-grid">
        {attrs.map((attr) => (
          <AttributeField
            key={attr.code}
            attr={attr}
            value={configuration[attr.code]}
            onChange={(value) => onChange({ [attr.code]: value })}
          />
        ))}
      </div>
      <p className="pf-config-foot">
        From spec: <span className="pf-mono">{specification.code}</span>
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
      <label htmlFor={id} className="pf-config-checkbox">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{attr.name}</span>
        {attr.isRequired && <span className="pf-config-required">*</span>}
        {helpText && <span className="pf-config-help">{helpText}</span>}
      </label>
    )
  }

  if (attr.attributeType === 'number') {
    const cons = (attr.constraints ?? {}) as { min?: number; max?: number; step?: number }
    const numericValue = typeof value === 'number' ? value : Number(value ?? attr.defaultValue ?? cons.min ?? 0)
    const isRange = cons.min != null && cons.max != null
    return (
      <div className="pf-config-field">
        <label htmlFor={id} className="pf-config-label">
          {attr.name}
          {attr.isRequired && <span className="pf-config-required">*</span>}
          <span className="pf-config-numeric">{numericValue}</span>
        </label>
        <input
          id={id}
          type={isRange ? 'range' : 'number'}
          min={cons.min}
          max={cons.max}
          step={cons.step ?? 1}
          value={Number.isFinite(numericValue) ? numericValue : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className={isRange ? 'pf-config-range' : 'pf-config-input'}
        />
        {helpText && <p className="pf-config-help">{helpText}</p>}
      </div>
    )
  }

  const options = attr.options ?? []
  if (options.length === 0) {
    return (
      <div className="pf-config-field">
        <label htmlFor={id} className="pf-config-label">
          {attr.name}
          {attr.isRequired && <span className="pf-config-required">*</span>}
        </label>
        <input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="pf-config-input"
        />
        {helpText && <p className="pf-config-help">{helpText}</p>}
      </div>
    )
  }

  return (
    <div className="pf-config-field">
      <label htmlFor={id} className="pf-config-label">
        {attr.name}
        {attr.isRequired && <span className="pf-config-required">*</span>}
      </label>
      <select
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="pf-config-select"
      >
        <option value="">— Select —</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {helpText && <p className="pf-config-help">{helpText}</p>}
    </div>
  )
}
