'use client'

import React from 'react'
import { WizardEngineProvider, useWizardEngine } from './engine'
import { getStepType } from './registry'
import type { WizardDefinitionResult, WizardStepProps } from './types'
import type { TenantScope } from '../services/types'

// ─── Step renderer ──────────────────────────────────────────────

function StepRenderer({ scope }: { scope: TenantScope }) {
  const { state, completeStep, goBack, skipStep } = useWizardEngine()
  const { currentStep, stepData, completedSteps, currentStepId, params, quoteId, customerId } = state

  const stepType = getStepType(currentStep.type)

  const stepProps: WizardStepProps = {
    stepData,
    completedSteps,
    currentStepId,
    stepDefinition: currentStep,
    config: currentStep.config,
    params,
    onComplete: completeStep,
    onBack: goBack,
    onSkip: skipStep,
    quoteId,
    customerId,
    scope,
  }

  if (!stepType) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center space-y-3">
        <p className="text-sm text-destructive">
          Unknown step type: <strong>{currentStep.type}</strong>
        </p>
        <p className="text-sm text-muted-foreground">This step type is not registered. Register it via <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">registerStepType()</code>.</p>
        <div className="flex gap-2 justify-center pt-2">
          {state.canGoBack && (
            <button type="button" onClick={goBack} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
              Back
            </button>
          )}
          {state.canSkip && (
            <button type="button" onClick={skipStep} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
              Skip
            </button>
          )}
        </div>
      </div>
    )
  }

  const Component = stepType.component
  return <Component {...stepProps} />
}

// ─── Progress bar ───────────────────────────────────────────────

function WizardProgress() {
  const { state } = useWizardEngine()
  const { definition, completedSteps, currentStepId, completionPercent } = state
  const steps = definition.steps

  return (
    <div className="flex items-center gap-1 py-2">
      {steps.map((step, idx) => {
        const isCompleted = completedSteps.includes(step.stepId)
        const isCurrent = step.stepId === currentStepId
        return (
          <div key={step.stepId} className="flex items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                isCompleted
                  ? 'bg-primary text-primary-foreground font-medium'
                  : isCurrent
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'bg-muted text-muted-foreground'
              }`}
              title={step.title}
            >
              {isCompleted ? '\u2713' : idx + 1}
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-6 h-0.5 ${isCompleted ? 'bg-primary' : 'bg-muted'}`} />
            )}
          </div>
        )
      })}
      <span className="ml-2 text-xs text-muted-foreground">
        {completionPercent}%
      </span>
    </div>
  )
}

// ─── Header ─────────────────────────────────────────────────────

function WizardHeader() {
  const { state } = useWizardEngine()

  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold">{state.definition.name}</h2>
        <p className="text-sm text-muted-foreground">
          Step: {state.currentStep.title}
        </p>
      </div>
    </div>
  )
}

// ─── Main Runner component ──────────────────────────────────────

interface WizardRunnerProps {
  definition: WizardDefinitionResult
  params?: Record<string, unknown>
  initialQuoteId?: string | null
  initialCustomerId?: string | null
  scope: TenantScope
  onComplete?: (stepData: Record<string, Record<string, unknown>>) => void
}

export function WizardRunner({
  definition,
  params,
  initialQuoteId,
  initialCustomerId,
  scope,
  onComplete,
}: WizardRunnerProps) {
  const handleComplete = React.useCallback(
    (stepData: Record<string, Record<string, unknown>>) => {
      onComplete?.(stepData)
    },
    [onComplete],
  )

  return (
    <WizardEngineProvider
      definition={definition}
      params={params}
      initialQuoteId={initialQuoteId}
      initialCustomerId={initialCustomerId}
      onComplete={handleComplete}
    >
      <div className="space-y-4">
        <WizardHeader />
        <WizardProgress />
        <div className="min-h-[200px]">
          <StepRenderer scope={scope} />
        </div>
      </div>
    </WizardEngineProvider>
  )
}
