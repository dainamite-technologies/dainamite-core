'use client'

import React from 'react'
import type { WizardStepProps } from '@dainamite/cpq/modules/cpq/workflows/types'

type ContextSelectOption = {
  value: string
  label: string
  description?: string
}

type ContextSelectConfig = {
  contextField: string
  options: ContextSelectOption[]
  required?: boolean
  default?: string
}

function isContextSelectConfig(value: unknown): value is ContextSelectConfig {
  if (!value || typeof value !== 'object') return false
  const cfg = value as Record<string, unknown>
  if (typeof cfg.contextField !== 'string' || cfg.contextField.length === 0) return false
  if (!Array.isArray(cfg.options)) return false
  return cfg.options.every((opt) => {
    if (!opt || typeof opt !== 'object') return false
    const o = opt as Record<string, unknown>
    return typeof o.value === 'string' && typeof o.label === 'string'
  })
}

export function ContextSelectStep({
  config,
  onComplete,
  onBack,
  stepData,
  currentStepId,
  completedSteps,
}: WizardStepProps) {
  const cfg = isContextSelectConfig(config) ? config : null

  const previous = stepData[currentStepId] as Record<string, unknown> | undefined
  const initialFromPrevious = cfg && previous ? (previous[cfg.contextField] as string | undefined) : undefined

  const [selected, setSelected] = React.useState<string | null>(
    initialFromPrevious ?? cfg?.default ?? null,
  )

  if (!cfg) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center space-y-3">
        <p className="text-sm text-red-600">
          <strong>context_select</strong> step is misconfigured.
        </p>
        <p className="text-sm text-muted-foreground">
          Required config: <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">contextField</code>
          {' and '}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">options[]</code>.
        </p>
      </div>
    )
  }

  const required = cfg.required !== false
  const canProceed = !required || selected != null

  const handleNext = () => {
    if (!selected) return
    onComplete({ [cfg.contextField]: selected })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        {cfg.options.map((option) => {
          const isSelected = selected === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={`text-left rounded-md border p-3 transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/30'
              }`}
            >
              <div className="font-medium text-sm">{option.label}</div>
              {option.description && (
                <div className="mt-0.5 text-xs text-muted-foreground">{option.description}</div>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 justify-end pt-2">
        {completedSteps.length > 0 && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={!canProceed}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default ContextSelectStep
