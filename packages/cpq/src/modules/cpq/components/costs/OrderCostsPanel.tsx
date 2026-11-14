'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import {
  assetLinksByOrderLine,
  hasCostAccess,
  type OrderCostsResponse,
  type SubscriptionCostsResponse,
} from '../../lib/orderInventoryCostView'
import { OrderCostsSection, type OrderCostLine } from './OrderCostsSection'
import { useCostsRead } from './useCostsRead'

const todayIso = () => new Date().toISOString().slice(0, 10)

/**
 * Loads and renders the cost section of an order page. Renders nothing while the toggle is off (`404`). Once the order
 * is activated, the costs of its linked subscriptions are read (holders only) to link asset-owned costs to their asset.
 * `refreshKey` changes when the order changes (for example after activation).
 */
export function OrderCostsPanel({ orderId, lines, currency, subscriptionIds, refreshKey }: {
  orderId: string
  lines: ReadonlyArray<OrderCostLine>
  currency: string
  subscriptionIds: ReadonlyArray<string>
  refreshKey?: string
}) {
  const t = useT()
  const { state, data, reload } = useCostsRead<OrderCostsResponse>(`/api/cpq/orders/${orderId}/costs`)
  const [subscriptions, setSubscriptions] = React.useState<SubscriptionCostsResponse[]>([])
  const idsKey = subscriptionIds.join('|')
  const holder = hasCostAccess(data)

  const firstKey = React.useRef(refreshKey)
  React.useEffect(() => {
    if (refreshKey === firstKey.current) return
    firstKey.current = refreshKey
    void reload()
  }, [refreshKey, reload])

  React.useEffect(() => {
    let cancelled = false
    if (!holder || !idsKey) { setSubscriptions([]); return }
    void (async () => {
      const calls = await Promise.all(idsKey.split('|').map((id) => apiCall<SubscriptionCostsResponse>(`/api/cpq/inventory/subscriptions/${id}/costs`)))
      if (!cancelled) setSubscriptions(calls.flatMap((call) => (call.ok && call.result ? [call.result] : [])))
    })()
    return () => { cancelled = true }
  }, [holder, idsKey])

  const links = React.useMemo(() => assetLinksByOrderLine(data, subscriptions), [data, subscriptions])
  if (state === 'off') return null
  if (state === 'loading') return <LoadingMessage label={t('cpq.orderCosts.loading', 'Loading costs…')} />
  if (state === 'error' || !data) return <ErrorMessage label={t('cpq.orderCosts.error', 'Costs could not be loaded.')} />
  return <OrderCostsSection response={data} lines={lines} currency={currency} assetLinks={links} today={todayIso()} />
}
