'use client'

import React from 'react'
import type { WizardStepProps } from '../types'

/**
 * Stub step type for inventory/subscription item selection.
 * Implementation deferred until the inventory/subscription domain exists.
 */
export function InventorySelectStep({ onBack, onSkip, completedSteps }: WizardStepProps) {
  return (
    <div className="rounded-lg border bg-card p-6 text-center space-y-3">
      <h3 className="text-lg font-semibold">Inventory Selection</h3>
      <p className="text-sm text-muted-foreground">
        This step type is not yet implemented. It will allow selecting existing customer
        inventory items for modification or renewal once the inventory domain is available.
      </p>
      <div className="flex gap-2 justify-center pt-2">
        {completedSteps.length > 0 && (
          <button type="button" onClick={onBack} className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex items-center justify-center rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
