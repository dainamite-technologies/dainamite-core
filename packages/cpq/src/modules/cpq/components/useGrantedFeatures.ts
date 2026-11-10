'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type FeatureCheckResponse = { granted: string[] }

/**
 * Resolve which of `features` the current user holds, through the framework's
 * `POST /api/auth/feature-check` endpoint (the same one the component-override
 * provider uses). Returns an empty list until the check completes, so callers
 * hide privileged actions by default.
 */
export function useGrantedFeatures(features: readonly string[]): readonly string[] {
  const [granted, setGranted] = React.useState<readonly string[]>([])
  const key = features.join('|')

  React.useEffect(() => {
    if (!key) return
    let cancelled = false
    void (async () => {
      const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: key.split('|') }),
      })
      if (!cancelled && call.ok && call.result?.granted) setGranted(call.result.granted)
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  return granted
}
