// ─── Wizard Domain Types ────────────────────────────────────────

import type { TenantScope } from '../services/types'

// ─── Step definition (stored in CpqWizardDefinition.steps JSONB) ──

export interface TransitionCondition {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists' | 'not_exists' | 'in'
  value?: unknown
}

export interface WizardTransition {
  targetStepId: string
  condition?: TransitionCondition
  isDefault?: boolean
  label?: string
}

export interface WizardStepValidation {
  field: string
  operator: 'eq' | 'neq' | 'exists' | 'not_exists'
  value?: unknown
  message: string
}

export interface WizardStepDefinition {
  stepId: string
  type: string
  title: string
  description?: string | null
  config: Record<string, unknown>
  transitions: WizardTransition[]
  isOptional?: boolean
  validationRules?: WizardStepValidation[]
}

// ─── Applicability ──────────────────────────────────────────────

export interface WizardApplicability {
  specCodes?: string[]
  offeringCodes?: string[]
  customerSegments?: string[]
  surface?: 'backend' | 'portal'
  priority?: number
}

// ─── Definition result ──────────────────────────────────────────

export interface WizardDefinitionResult {
  id: string
  code: string
  name: string
  description: string | null
  version: number
  steps: WizardStepDefinition[]
  applicability: WizardApplicability | null
  paramsSchema: Record<string, unknown> | null
  surface: string
  isActive: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

// ─── Service inputs ─────────────────────────────────────────────

export interface WizardResolveContext {
  surface: 'backend' | 'portal'
  specCode?: string
  offeringCode?: string
  customerSegment?: string
}

export interface WizardDefinitionFilter {
  surface?: string
  isActive?: boolean
}

// ─── Step type registry ─────────────────────────────────────────

export interface WizardStepProps {
  stepData: Record<string, Record<string, unknown>>
  completedSteps: string[]
  currentStepId: string
  stepDefinition: WizardStepDefinition
  config: Record<string, unknown>
  params: Record<string, unknown>
  onComplete: (stepOutput: Record<string, unknown>) => void
  onBack: () => void
  onSkip: () => void
  quoteId: string | null
  customerId: string | null
  scope: TenantScope
}

export interface WizardStepType {
  type: string
  label: string
  description: string
  component: React.ComponentType<WizardStepProps>
}
