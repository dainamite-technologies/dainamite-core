'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Lock } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import {
  COST_ROLE_FALLBACKS,
  COST_SOURCE_FALLBACKS,
  COST_STATUS_FALLBACKS,
  isFullCost,
  type FullQuoteCost,
  type RedactedQuoteCost,
} from '../../../../../lib/quoteCostView'

export const QUOTE_LINE_COSTS_SPOT_ID = 'data-table:cpq.quote_line_costs'

const STATUS_VARIANTS: Record<string, 'warning' | 'info' | 'success'> = { none: 'warning', estimated: 'info', confirmed: 'success' }

/** Rendered per cost row in the actions column (step 20 supplies Edit / Confirm / Delete). */
export type CostRowActions = (cost: FullQuoteCost) => React.ReactNode

export function CostsPanel({ quoteId, lineId, lineName, costs, locked, status, canManage, renderRowActions, headerActions }: {
  quoteId: string
  lineId: string
  lineName: string
  costs: Array<RedactedQuoteCost | FullQuoteCost>
  locked: boolean
  status: string
  canManage: boolean
  renderRowActions?: CostRowActions
  headerActions?: React.ReactNode
}) {
  const t = useT()
  const rows = costs.filter(isFullCost)
  const lockedText = t(
    'cpq.quoteCosts.locked',
    'Costs that change the price are locked in status {status} — margin-only costs and confirmations remain possible.',
    { status },
  )
  return (
    <div className="border-t bg-muted/5 px-12 py-2" data-testid="cpq-costs-panel">
      <div className="flex items-center justify-between pb-1">
        <h4 className="text-xs font-medium">
          {t('cpq.quoteCosts.title', 'Costs')}
          <span className="ml-2 text-muted-foreground">{rows.length}</span>
          {!canManage && (
            <span className="ml-2 font-normal text-muted-foreground" data-testid="cpq-costs-readonly">{t('cpq.quoteCosts.readOnly', 'read-only')}</span>
          )}
        </h4>
        <div className="flex items-center gap-2">
          {locked && (
            <SimpleTooltip content={lockedText} size="sm">
              <span className="inline-flex cursor-help items-center gap-1 text-xs text-muted-foreground" tabIndex={0} aria-label={lockedText} data-testid="cpq-costs-locked">
                <Lock className="h-3 w-3" aria-hidden />
                {t('cpq.quoteCosts.lockedShort', 'Locked in {status}', { status })}
              </span>
            </SimpleTooltip>
          )}
          {headerActions}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground" data-testid="cpq-costs-empty">
          {t('cpq.quoteCosts.empty', 'No costs on this line. Margin is not tracked for it.')}
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.name', 'Name')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.role', 'Role')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.source', 'Source')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.status', 'Status')}</th>
              <th className="py-1 text-right font-medium">{t('cpq.quoteCosts.value', 'Value')}</th>
              <th className="py-1 pl-2 text-left font-medium">{t('cpq.quoteCosts.currency', 'Currency')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.supplier', 'Supplier')}</th>
              <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.validUntil', 'Valid until')}</th>
              {renderRowActions && <th className="w-20" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((cost) => {
              const source = cost.origin === 'manual' ? 'manual' : cost.source
              return (
                <tr key={cost.id} className="border-t border-dashed border-border/50" data-testid="cpq-cost-row">
                  <td className="py-1 font-medium">
                    {cost.name}
                    {cost.chargeCode && <span className="ml-1 font-mono font-normal text-muted-foreground">{cost.chargeCode}</span>}
                  </td>
                  <td className="py-1">{t(`cpq.quoteCosts.roles.${cost.role}`, COST_ROLE_FALLBACKS[cost.role] ?? cost.role)}</td>
                  <td className="py-1">{t(`cpq.quoteCosts.sources.${source}`, COST_SOURCE_FALLBACKS[source] ?? source)}</td>
                  <td className="py-1">
                    <Tag variant={STATUS_VARIANTS[cost.valueStatus] ?? 'neutral'} className="px-1.5 text-xs">
                      {t(`cpq.quoteCosts.statuses.${cost.valueStatus}`, COST_STATUS_FALLBACKS[cost.valueStatus] ?? cost.valueStatus)}
                    </Tag>
                    {cost.expired && (
                      <Tag variant="error" className="ml-1 px-1.5 text-xs">{t('cpq.quoteCosts.badges.expired', 'Expired cost')}</Tag>
                    )}
                    {cost.error && <span className="ml-1 text-destructive">{t(`cpq.quoteCosts.errors.${cost.error}`, cost.error)}</span>}
                  </td>
                  <td className="py-1 text-right font-mono">{cost.unitAmount ?? '—'}</td>
                  <td className="py-1 pl-2">{cost.currencyCode ?? '—'}</td>
                  <td className="py-1">{cost.supplierName ?? '—'}</td>
                  <td className="py-1">{cost.validUntil ?? '—'}</td>
                  {renderRowActions && <td className="py-1 text-right whitespace-nowrap">{renderRowActions(cost)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <InjectionSpot spotId={QUOTE_LINE_COSTS_SPOT_ID} context={{ quoteId, lineId, lineName, costs: rows }} />
    </div>
  )
}
