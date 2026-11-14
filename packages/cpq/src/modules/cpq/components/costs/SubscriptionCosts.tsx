'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { CostsReadState } from './useCostsRead'
import { hasCostAccess, type SubscriptionCostsResponse } from '../../lib/orderInventoryCostView'
import { CostChips } from './CostRowsTable'
import { AssetMarginFigures, InventoryCostsBlock, ItemMarginFigures } from './InventoryCostsBlock'

export const todayIso = (): string => new Date().toISOString().slice(0, 10)

/**
 * Costs section placeholder for a failed read: the standard ErrorMessage on a non-404 failure (like the order and
 * asset panels). `off` (404: toggle off) and every other state render nothing.
 */
export function SubscriptionCostsReadError({ state }: { state: CostsReadState }) {
  const t = useT()
  if (state !== 'error') return null
  return <ErrorMessage label={t('cpq.inventoryCosts.error', 'Costs could not be loaded.')} />
}

/** Status chips of one subscription item, for the item row (everyone). */
export function SubscriptionItemCostChips({ response, itemId }: { response: SubscriptionCostsResponse | null; itemId: string }) {
  const entry = response?.items.find((item) => item.subscriptionItemId === itemId)
  if (!entry) return null
  return <CostChips costs={entry.costs} today={todayIso()} />
}

/** Costs of one subscription item (inside its expanded panel): rows, "No cost recorded", item margin for holders. */
export function SubscriptionItemCosts({ response, itemId, currency }: { response: SubscriptionCostsResponse; itemId: string; currency: string }) {
  const t = useT()
  const entry = response.items.find((item) => item.subscriptionItemId === itemId)
  const holder = hasCostAccess(response)
  const cur = response.currencyCode ?? currency
  return (
    <div data-testid="cpq-item-costs">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t('cpq.inventoryCosts.title', 'Costs')}</p>
      <InventoryCostsBlock
        costs={entry?.costs}
        currency={cur}
        today={todayIso()}
        margin={holder && entry?.margin ? <ItemMarginFigures margin={entry.margin} currency={cur} title={t('cpq.inventoryCosts.itemMargin', 'Item margin')} testId="cpq-item-margin" /> : undefined}
      />
    </div>
  )
}

/**
 * The subscription Costs section: the Ended costs toggle, the subscription roll-up (holders) and the costs and margin
 * of each cost-owning asset. Item costs render inside each item's panel. Read-only for everyone.
 */
export function SubscriptionCostsSection({ response, includeEnded, onToggleEnded, assets, currency }: {
  response: SubscriptionCostsResponse
  includeEnded: boolean
  onToggleEnded: () => void
  assets: ReadonlyArray<{ id: string; name: string }>
  currency: string
}) {
  const t = useT()
  const holder = hasCostAccess(response)
  const cur = response.currencyCode ?? currency
  const nameOf = (assetId: string) => assets.find((asset) => asset.id === assetId)?.name
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3" aria-label={t('cpq.inventoryCosts.title', 'Costs')} data-testid="cpq-subscription-costs">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t('cpq.inventoryCosts.title', 'Costs')}</h3>
        <Button type="button" variant={includeEnded ? 'default' : 'outline'} size="sm" aria-pressed={includeEnded} onClick={onToggleEnded} data-testid="cpq-ended-costs-toggle">
          {t('cpq.inventoryCosts.endedToggle', 'Ended costs')}
        </Button>
      </div>
      {holder && response.margin && (
        <ItemMarginFigures margin={response.margin} currency={cur} title={t('cpq.inventoryCosts.rollup', 'Subscription margin (items and assets)')} testId="cpq-subscription-margin" />
      )}
      {response.assets.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="cpq-subscription-no-asset-costs">{t('cpq.inventoryCosts.noAssetCosts', 'No asset carries costs.')}</p>
      ) : (
        response.assets.map((asset) => (
          <div key={asset.assetId} className="space-y-1" data-testid="cpq-asset-costs">
            <p className="text-xs font-medium">
              <a className="text-primary hover:underline" href={`/backend/cpq/inventory/assets/${asset.assetId}`}>{nameOf(asset.assetId) ?? asset.assetId.slice(0, 8)}</a>
            </p>
            <InventoryCostsBlock
              costs={asset.costs}
              currency={cur}
              today={todayIso()}
              margin={holder && asset.margin ? <AssetMarginFigures margin={asset.margin} currency={cur} testId="cpq-asset-margin" /> : undefined}
            />
          </div>
        ))
      )}
    </section>
  )
}
