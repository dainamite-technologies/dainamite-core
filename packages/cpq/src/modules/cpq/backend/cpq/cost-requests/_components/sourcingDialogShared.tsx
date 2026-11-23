'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { sourcingErrorFallback, type SourcingFailure } from '../../../../lib/costSourcingView'

/** What a sourcing dialog operates on. `quoteId` is the CPQ quote id the cost routes take. */
export type SourcingTarget = {
  quoteId: string
  costId: string
  costRequestId: string
  requestSeq: number | null
  costName: string
  /** "Q-123 · Fiber 100M" style context line. */
  contextLabel?: string | null
  cpqStatus: string
  /** The quote is locked (price-affecting values need Reopen and apply). */
  locked: boolean
  /** The request's estimate currency, else the quote currency. */
  defaultCurrency: string
  supplierId?: string | null
  supplierName?: string | null
}

export type SourcingDialogProps = {
  target: SourcingTarget
  onClose: () => void
  /** Called after a successful write (the caller refreshes its data). */
  onDone: (outcome?: string) => void
  /** Called for failures the dialog cannot resolve itself: refresh the row or drop it (the caller flashes `failure.code`). */
  onFailure: (failure: SourcingFailure) => void
}

/** Ctrl/Cmd+Enter submits (Escape is the Radix dialog's own). */
export function submitOnModEnter(submit: () => void) {
  return (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
  }
}

/** Inline error of a failed write; `QUOTE_CONVERTED` with an order id offers the Re-confirm link. */
export function SourcingErrorAlert({ failure, issues }: { failure: SourcingFailure | null; issues?: string[] }) {
  const t = useT()
  if (!failure && (!issues || issues.length === 0)) return null
  return (
    <Alert variant="warning" data-testid="cpq-sourcing-errors">
      <AlertDescription>
        {issues && issues.length > 0 && <span className="block">{issues.join(' · ')}</span>}
        {failure && <span className="block">{t(`cpq.costRequests.errors.${failure.code}`, sourcingErrorFallback(failure.code))}</span>}
        {failure?.code === 'QUOTE_CONVERTED' && failure.orderId && (
          <a className="mt-1 inline-block underline" href={`/backend/cpq/orders/${failure.orderId}`} data-testid="cpq-reconfirm-link">
            {t('cpq.costRequests.reconfirmOnOrder', 'Re-confirm on order')}
          </a>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function SourcingField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
