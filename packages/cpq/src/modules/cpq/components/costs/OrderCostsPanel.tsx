'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RotateCcw } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import {
  assetLinksByOrderLine,
  hasCostAccess,
  type OrderCostsResponse,
  type FullCostRow,
  type SubscriptionCostsResponse,
} from '../../lib/orderInventoryCostView'
import { canReconfirm } from '../../lib/orderReconfirmView'
import { useGrantedFeatures } from '../useGrantedFeatures'
import { ReconfirmCostDialog } from './ReconfirmCostDialog'
import { OrderCostsSection, type OrderCostLine } from './OrderCostsSection'
import { useCostsRead, type CostsReadResult } from './useCostsRead'

const todayIso = () => new Date().toISOString().slice(0, 10)

/**
 * Loads and renders the cost section of an order page. Renders nothing while the toggle is off (`404`). Once the order
 * is activated, the costs of its linked subscriptions are read (holders only) to link asset-owned costs to their asset.
 * `refreshKey` changes when the order changes (for example after activation).
 */
export function OrderCostsPanel({ orderId, lines, currency, subscriptionIds, refreshKey, read, orderStatus }: {
  orderId: string
  /** The page's own costs read (shared with the line diff); the panel loads its own when absent. */
  read?: CostsReadResult<OrderCostsResponse>
  lines: ReadonlyArray<OrderCostLine>
  currency: string
  subscriptionIds: ReadonlyArray<string>
  refreshKey?: string
  /** The order's CPQ status: Re-confirm is offered on draft / pending orders only. */
  orderStatus?: string
}) {
  const t = useT()
  const granted = useGrantedFeatures(['cpq.costs.view', 'cpq.costs.manage', 'cpq.orders.manage'])
  const [reconfirming, setReconfirming] = React.useState<{ cost: FullCostRow; line: OrderCostLine } | null>(null)
  const own = useCostsRead<OrderCostsResponse>(read ? null : `/api/cpq/orders/${orderId}/costs`)
  const { state, data, reload } = read ?? own
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
  const reconfirmable = orderStatus !== undefined && canReconfirm(orderStatus, granted)
  return (
    <>
      <OrderCostsSection
        response={data} lines={lines} currency={currency} assetLinks={links} today={todayIso()}
        renderCostActions={reconfirmable ? (cost, line) => (
          <IconButton variant="ghost" size="xs" aria-label={t('cpq.orderCosts.reconfirm.action', 'Re-confirm')} title={t('cpq.orderCosts.reconfirm.action', 'Re-confirm')}
            onClick={() => setReconfirming({ cost, line })} data-testid="cpq-cost-reconfirm">
            <RotateCcw className="h-3.5 w-3.5" />
          </IconButton>
        ) : undefined}
      />
      {reconfirming && (
        <ReconfirmCostDialog
          orderId={orderId} cost={reconfirming.cost} lineName={reconfirming.line.name} currency={data.currencyCode ?? currency}
          onClose={() => setReconfirming(null)}
          onDone={() => { setReconfirming(null); flash(t('cpq.orderCosts.reconfirm.flash', 'Cost re-confirmed'), 'success'); void reload() }}
        />
      )}
    </>
  )
}
