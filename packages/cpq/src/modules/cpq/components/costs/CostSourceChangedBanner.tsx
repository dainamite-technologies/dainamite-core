'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { COST_SOURCE_CHANGED_FALLBACKS, type CostSourceChangedView } from '../../lib/arcCostView'

/**
 * `409 COST_SOURCE_CHANGED` (conversion or activation): the subscription's costs changed since the quote mirrored them. Names the
 * lines (and the cost keys that differ). Before conversion each line offers Refresh from subscription; after it the only way out is to
 * cancel the order and create a new Amend. No amounts: the 409 body carries none.
 */
export function CostSourceChangedBanner({ view, onRefresh, busyLineId }: {
  view: CostSourceChangedView
  /** Quote phase only: refreshes one line from its subscription item. */
  onRefresh?: (quoteLineId: string) => void
  busyLineId?: string | null
}) {
  const t = useT()
  return (
    <Alert variant="warning" data-testid="cpq-cost-source-changed">
      <AlertTitle>{t('cpq.arc.sourceChanged.title', COST_SOURCE_CHANGED_FALLBACKS.title)}</AlertTitle>
      <AlertDescription>
        <span className="block">
          {view.phase === 'quote'
            ? t('cpq.arc.sourceChanged.quote', COST_SOURCE_CHANGED_FALLBACKS.quote)
            : t('cpq.arc.sourceChanged.order', COST_SOURCE_CHANGED_FALLBACKS.order)}
        </span>
        {view.lines.length > 0 && (
          <ul className="mt-1 space-y-1 text-xs">
            {view.lines.map((line) => (
              <li key={line.quoteLineId} className="flex flex-wrap items-center gap-2" data-testid="cpq-cost-source-changed-line">
                <span className="font-medium">{line.name}</span>
                {line.costKeys.length > 0 && <span className="font-mono text-muted-foreground">{line.costKeys.join(', ')}</span>}
                {line.refreshable && onRefresh && (
                  <Button variant="outline" size="sm" disabled={busyLineId === line.quoteLineId} onClick={() => onRefresh(line.quoteLineId)} data-testid="cpq-cost-source-changed-refresh">
                    <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                    {t('cpq.arc.refresh.action', 'Refresh from subscription')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}
