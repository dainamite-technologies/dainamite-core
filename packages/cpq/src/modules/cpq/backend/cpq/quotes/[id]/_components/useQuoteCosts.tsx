'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { FullQuoteCost, QuoteCostsResponse, RedactedQuoteCost } from '../../../../../lib/quoteCostView'

export type QuoteCostsState = 'loading' | 'off' | 'error' | 'ready'

/**
 * Loads `GET /api/cpq/quotes/{id}/costs` (status-only without `cpq.costs.view`,
 * full projection with it) and refetches whenever the quote's pricing revision
 * moves. `404` means the tenant toggle is off: the quote page shows nothing.
 */
export function useQuoteCosts({ quoteId, revision }: { quoteId: string | null; revision: number }) {
  const [state, setState] = React.useState<QuoteCostsState>('loading')
  const [data, setData] = React.useState<QuoteCostsResponse | null>(null)

  const load = React.useCallback(async () => {
    if (!quoteId) return
    const call = await apiCall<QuoteCostsResponse>(`/api/cpq/quotes/${quoteId}/costs`)
    if (call.ok && call.result) { setData(call.result); setState('ready'); return }
    setData(null)
    setState(call.status === 404 ? 'off' : 'error')
  }, [quoteId])

  React.useEffect(() => { void load() }, [load, revision])

  const byLine = React.useMemo(
    () => new Map<string, Array<RedactedQuoteCost | FullQuoteCost>>((data?.lines ?? []).map((line) => [line.quoteLineId, line.costs])),
    [data],
  )

  return { state, data, byLine, reload: load }
}
