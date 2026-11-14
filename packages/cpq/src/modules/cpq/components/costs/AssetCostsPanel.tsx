'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { hasCostAccess, includeEndedQuery, type AssetCostsResponse } from '../../lib/orderInventoryCostView'
import { AssetMarginFigures, InventoryCostsBlock } from './InventoryCostsBlock'
import { useCostsRead } from './useCostsRead'

/** Injection spot of the asset Costs section: add-ons extend it (context: assetId, subscriptionId, ownerItemId, costs). */
export const ASSET_COSTS_SPOT_ID = 'data-table:cpq.inventory_asset_costs'

const todayIso = () => new Date().toISOString().slice(0, 10)

/** The section body, separate from loading so it renders statically. */
export function AssetCostsSectionView({ response, currency, today, includeEnded, onToggleEnded, subscriptionId, ownerItemName }: {
  response: AssetCostsResponse
  currency: string
  today: string
  includeEnded: boolean
  onToggleEnded: () => void
  subscriptionId: string | null
  ownerItemName?: string | null
}) {
  const t = useT()
  const holder = hasCostAccess(response)
  const cur = response.currencyCode ?? currency
  const title = t('cpq.inventoryCosts.title', 'Costs')
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3" aria-label={title} data-testid="cpq-asset-costs-section">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        {!response.ownerItemId && (
          <Button type="button" variant={includeEnded ? 'default' : 'outline'} size="sm" aria-pressed={includeEnded} onClick={onToggleEnded} data-testid="cpq-ended-costs-toggle">
            {t('cpq.inventoryCosts.endedToggle', 'Ended costs')}
          </Button>
        )}
      </div>
      {response.ownerItemId ? (
        <p className="text-sm" data-testid="cpq-asset-owner-item">
          {t('cpq.inventoryCosts.ownerItem', 'Costs are recorded on item')}{' '}
          {subscriptionId ? (
            <a className="text-primary hover:underline" href={`/backend/cpq/inventory/subscriptions/${subscriptionId}`}>{ownerItemName ?? response.ownerItemId.slice(0, 8)}</a>
          ) : (
            <span className="font-medium">{ownerItemName ?? response.ownerItemId.slice(0, 8)}</span>
          )}
        </p>
      ) : (
        <InventoryCostsBlock
          costs={response.costs}
          currency={cur}
          today={today}
          margin={holder && response.margin ? <AssetMarginFigures margin={response.margin} currency={cur} testId="cpq-asset-margin" /> : undefined}
        />
      )}
      <InjectionSpot spotId={ASSET_COSTS_SPOT_ID} context={{ assetId: response.assetId, subscriptionId, ownerItemId: response.ownerItemId, costs: response.costs }} />
    </section>
  )
}

/** Loads the asset costs (nothing on a 404: toggle off) and renders the Costs section of the asset page. */
export function AssetCostsPanel({ assetId, subscriptionId, currency }: { assetId: string; subscriptionId: string | null; currency: string }) {
  const t = useT()
  const [includeEnded, setIncludeEnded] = React.useState(false)
  const [ownerItemName, setOwnerItemName] = React.useState<string | null>(null)
  const { state, data } = useCostsRead<AssetCostsResponse>(`/api/cpq/inventory/assets/${assetId}/costs${includeEndedQuery(includeEnded)}`)
  const ownerItemId = data?.ownerItemId ?? null

  React.useEffect(() => {
    let cancelled = false
    if (!ownerItemId || !subscriptionId) { setOwnerItemName(null); return }
    void (async () => {
      const call = await apiCall<{ items?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>(`/api/cpq/inventory/subscription-items?subscriptionId=${subscriptionId}`)
      const rows = Array.isArray(call.result) ? call.result : call.result?.items ?? []
      if (!cancelled) setOwnerItemName(rows.find((row) => row.id === ownerItemId)?.name ?? null)
    })()
    return () => { cancelled = true }
  }, [ownerItemId, subscriptionId])

  if (state === 'off') return null
  if (state === 'loading') return <LoadingMessage label={t('cpq.inventoryCosts.loading', 'Loading costs…')} />
  if (state === 'error' || !data) return <ErrorMessage label={t('cpq.inventoryCosts.error', 'Costs could not be loaded.')} />
  return (
    <AssetCostsSectionView
      response={data}
      currency={currency}
      today={todayIso()}
      includeEnded={includeEnded}
      onToggleEnded={() => setIncludeEnded((prev) => !prev)}
      subscriptionId={subscriptionId}
      ownerItemName={ownerItemName}
    />
  )
}
