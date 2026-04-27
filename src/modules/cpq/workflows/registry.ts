import type { WizardStepType } from './types'

const stepTypes = new Map<string, WizardStepType>()

export function registerStepType(stepType: WizardStepType) {
  stepTypes.set(stepType.type, stepType)
}

export function getStepType(type: string): WizardStepType | undefined {
  return stepTypes.get(type)
}

export function listStepTypes(): WizardStepType[] {
  return Array.from(stepTypes.values())
}
