'use client'

import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react'
import type {
  WizardDefinitionResult,
  WizardStepDefinition,
  TransitionCondition,
} from './types'

// ─── Engine state ───────────────────────────────────────────────

export interface WizardEngineState {
  definition: WizardDefinitionResult
  params: Record<string, unknown>
  currentStepId: string
  completedSteps: string[]
  stepData: Record<string, Record<string, unknown>>
  currentStep: WizardStepDefinition
  canGoBack: boolean
  canSkip: boolean
  isFirstStep: boolean
  isLastStep: boolean
  completionPercent: number
  quoteId: string | null
  customerId: string | null
}

type EngineAction =
  | { type: 'COMPLETE_STEP'; stepId: string; output: Record<string, unknown>; nextStepId: string }
  | { type: 'GO_BACK'; prevStepId: string }
  | { type: 'SKIP_STEP'; nextStepId: string }
  | { type: 'SET_QUOTE_ID'; quoteId: string }
  | { type: 'SET_CUSTOMER_ID'; customerId: string }

function resolveStep(definition: WizardDefinitionResult, stepId: string): WizardStepDefinition {
  const step = definition.steps.find((s) => s.stepId === stepId)
  if (!step) throw new Error(`Step '${stepId}' not found in wizard '${definition.code}'`)
  return step
}

function engineReducer(state: WizardEngineState, action: EngineAction): WizardEngineState {
  switch (action.type) {
    case 'COMPLETE_STEP': {
      const newCompletedSteps = [...state.completedSteps, action.stepId]
      const newStepData = {
        ...state.stepData,
        [action.stepId]: action.output,
      }
      const nextStep = resolveStep(state.definition, action.nextStepId)
      // Auto-propagate quoteId / customerId from step output
      const newQuoteId = (typeof action.output.quoteId === 'string' && action.output.quoteId)
        ? action.output.quoteId : state.quoteId
      const newCustomerId = (typeof action.output.customerId === 'string' && action.output.customerId)
        ? action.output.customerId : state.customerId
      return {
        ...state,
        currentStepId: action.nextStepId,
        completedSteps: newCompletedSteps,
        stepData: newStepData,
        currentStep: nextStep,
        canGoBack: newCompletedSteps.length > 0,
        isFirstStep: false,
        isLastStep: nextStep.transitions.length === 0,
        completionPercent: Math.round((newCompletedSteps.length / state.definition.steps.length) * 100),
        canSkip: nextStep.isOptional === true,
        quoteId: newQuoteId,
        customerId: newCustomerId,
      }
    }

    case 'GO_BACK': {
      const newCompletedSteps = state.completedSteps.filter((s) => s !== action.prevStepId)
      const prevStep = resolveStep(state.definition, action.prevStepId)
      return {
        ...state,
        currentStepId: action.prevStepId,
        completedSteps: newCompletedSteps,
        currentStep: prevStep,
        canGoBack: newCompletedSteps.length > 0,
        isFirstStep: newCompletedSteps.length === 0,
        isLastStep: prevStep.transitions.length === 0,
        completionPercent: Math.round((newCompletedSteps.length / state.definition.steps.length) * 100),
        canSkip: prevStep.isOptional === true,
      }
    }

    case 'SKIP_STEP': {
      const nextStep = resolveStep(state.definition, action.nextStepId)
      return {
        ...state,
        currentStepId: action.nextStepId,
        currentStep: nextStep,
        isLastStep: nextStep.transitions.length === 0,
        canSkip: nextStep.isOptional === true,
      }
    }

    case 'SET_QUOTE_ID':
      return { ...state, quoteId: action.quoteId }

    case 'SET_CUSTOMER_ID':
      return { ...state, customerId: action.customerId }

    default:
      return state
  }
}

// ─── Transition evaluation ──────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function evaluateCondition(
  condition: TransitionCondition,
  stepData: Record<string, Record<string, unknown>>,
  params: Record<string, unknown>,
): boolean {
  const context = { stepData, params }
  const actual = getNestedValue(context as unknown as Record<string, unknown>, condition.field)

  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'not_exists':
      return actual === undefined || actual === null
    case 'eq':
      return actual === condition.value
    case 'neq':
      return actual !== condition.value
    case 'gt':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value
    case 'lt':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value
    case 'gte':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value
    case 'lte':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual)
    default:
      return false
  }
}

export function resolveNextStep(
  step: WizardStepDefinition,
  stepData: Record<string, Record<string, unknown>>,
  params: Record<string, unknown>,
): string | null {
  // Evaluate transitions in order, first match wins
  for (const transition of step.transitions) {
    if (!transition.condition) {
      if (transition.isDefault) return transition.targetStepId
      // No condition and no default flag = unconditional transition (take it)
      return transition.targetStepId
    }
    if (evaluateCondition(transition.condition, stepData, params)) {
      return transition.targetStepId
    }
  }
  // Fall back to default transition
  const defaultTransition = step.transitions.find((t) => t.isDefault)
  if (defaultTransition) return defaultTransition.targetStepId

  // No valid transition = end of wizard
  return null
}

// ─── Context ────────────────────────────────────────────────────

interface WizardEngineContextValue {
  state: WizardEngineState
  completeStep: (stepOutput: Record<string, unknown>) => void
  goBack: () => void
  skipStep: () => void
}

const WizardEngineContext = createContext<WizardEngineContextValue | null>(null)

export function useWizardEngine(): WizardEngineContextValue {
  const ctx = useContext(WizardEngineContext)
  if (!ctx) throw new Error('useWizardEngine must be used within a WizardEngineProvider')
  return ctx
}

// ─── Provider ───────────────────────────────────────────────────

interface WizardEngineProviderProps {
  definition: WizardDefinitionResult
  params?: Record<string, unknown>
  initialQuoteId?: string | null
  initialCustomerId?: string | null
  children: React.ReactNode
  onComplete?: (stepData: Record<string, Record<string, unknown>>) => void
}

export function WizardEngineProvider({
  definition,
  params: launchParams = {},
  initialQuoteId = null,
  initialCustomerId = null,
  children,
  onComplete,
}: WizardEngineProviderProps) {
  const firstStep = definition.steps[0]
  if (!firstStep) throw new Error(`Wizard '${definition.code}' has no steps`)

  const initialState: WizardEngineState = {
    definition,
    params: launchParams,
    currentStepId: firstStep.stepId,
    completedSteps: [],
    stepData: {},
    currentStep: firstStep,
    canGoBack: false,
    canSkip: firstStep.isOptional === true,
    isFirstStep: true,
    isLastStep: firstStep.transitions.length === 0,
    completionPercent: 0,
    quoteId: initialQuoteId,
    customerId: initialCustomerId,
  }

  const [state, dispatch] = useReducer(engineReducer, initialState)

  const completeStep = useCallback(
    (stepOutput: Record<string, unknown>) => {
      const updatedStepData = {
        ...state.stepData,
        [state.currentStep.stepId]: stepOutput,
      }

      const nextStepId = resolveNextStep(state.currentStep, updatedStepData, state.params)

      if (!nextStepId) {
        // Wizard complete
        onComplete?.(updatedStepData)
        return
      }

      dispatch({ type: 'COMPLETE_STEP', stepId: state.currentStep.stepId, output: stepOutput, nextStepId })
    },
    [state, onComplete],
  )

  const goBack = useCallback(() => {
    if (state.completedSteps.length === 0) return
    const prevStepId = state.completedSteps[state.completedSteps.length - 1]
    dispatch({ type: 'GO_BACK', prevStepId })
  }, [state.completedSteps])

  const skipStep = useCallback(() => {
    if (!state.currentStep.isOptional) return
    const nextStepId = resolveNextStep(state.currentStep, state.stepData, state.params)
    if (nextStepId) {
      dispatch({ type: 'SKIP_STEP', nextStepId })
    }
  }, [state])

  const value = useMemo(
    () => ({ state, completeStep, goBack, skipStep }),
    [state, completeStep, goBack, skipStep],
  )

  return (
    <WizardEngineContext.Provider value={value}>
      {children}
    </WizardEngineContext.Provider>
  )
}
