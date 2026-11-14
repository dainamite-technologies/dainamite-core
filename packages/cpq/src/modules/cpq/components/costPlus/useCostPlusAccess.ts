'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { COSTS_MANAGE_FEATURE, COSTS_VIEW_FEATURE } from '../../data/costs'
import { useGrantedFeatures } from '../useGrantedFeatures'

const FEATURES = [COSTS_VIEW_FEATURE, COSTS_MANAGE_FEATURE] as const

/**
 * What the current user may see of cost-plus pricing. `enabled` is the tenant
 * toggle (`GET /api/cpq/cost-plus/usage`, which needs `cpq.costs.view`, so it is
 * false for everyone else). Display gating only; the server enforces.
 */
export function useCostPlusAccess() {
  const granted = useGrantedFeatures(FEATURES)
  const canView = granted.includes(COSTS_VIEW_FEATURE)
  const canManage = granted.includes(COSTS_MANAGE_FEATURE)
  const [enabled, setEnabled] = React.useState(false)

  React.useEffect(() => {
    if (!canView) { setEnabled(false); return }
    let cancelled = false
    void (async () => {
      const call = await apiCall<{ enabled: boolean }>('/api/cpq/cost-plus/usage')
      if (!cancelled) setEnabled(call.ok && call.result?.enabled === true)
    })()
    return () => { cancelled = true }
  }, [canView])

  return { enabled, canView, canManage }
}
