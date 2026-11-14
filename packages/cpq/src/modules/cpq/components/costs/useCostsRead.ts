'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type CostsReadState = 'loading' | 'off' | 'error' | 'ready'

/**
 * Loads one of the cost read routes. A `404` means the tenant toggle `cpq.cost_plus` is off (or the owner is
 * gone): the caller renders nothing. The projection (status-only or full) is the server's decision.
 */
export function useCostsRead<T>(url: string | null): { state: CostsReadState; data: T | null; reload: () => Promise<void> } {
  const [state, setState] = React.useState<CostsReadState>('loading')
  const [data, setData] = React.useState<T | null>(null)

  const load = React.useCallback(async () => {
    if (!url) { setData(null); setState('off'); return }
    const call = await apiCall<T>(url)
    if (call.ok && call.result) { setData(call.result); setState('ready'); return }
    setData(null)
    setState(call.status === 404 ? 'off' : 'error')
  }, [url])

  React.useEffect(() => { void load() }, [load])

  return { state, data, reload: load }
}
