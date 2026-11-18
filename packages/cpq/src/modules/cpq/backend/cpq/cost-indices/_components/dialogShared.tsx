'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { costIndexErrorFallback, type CostIndexFailure } from '../../../../lib/costIndexView'

/** Ctrl/Cmd+Enter submits (Escape is the Radix dialog's own). */
export function submitOnModEnter(submit: () => void) {
  return (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
  }
}

export function IndexField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** Inline write failure plus form issues; the `INDEX_IN_USE` refusal lists the referencing elements. */
export function IndexErrorAlert({ failure, issues }: { failure: CostIndexFailure | null; issues?: string[] }) {
  const t = useT()
  if (!failure && (!issues || issues.length === 0)) return null
  return (
    <Alert variant="warning" data-testid="cpq-cost-index-errors">
      <AlertDescription>
        {issues && issues.length > 0 && <span className="block">{issues.join(' · ')}</span>}
        {failure && <span className="block">{t(`cpq.costIndices.errors.${failure.code}`, costIndexErrorFallback(failure.code))}</span>}
        {failure && failure.elements.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-xs" data-testid="cpq-cost-index-in-use">
            {failure.elements.map((element) => (
              <li key={element.id}>{element.chargeCode ? `${element.chargeCode} · ${element.name}` : element.name}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}
