'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { COST_ROLE_FALLBACKS, COST_STATUS_FALLBACKS } from '../../lib/quoteCostView'
import {
  PERIOD_FALLBACKS,
  badgeInputs,
  costValueView,
  isEnded,
  isFullCostRow,
  type CostRow,
  type FullCostRow,
} from '../../lib/orderInventoryCostView'
import { CostStatusBadges } from '../../backend/cpq/quotes/[id]/_components/CostStatusBadges'

const STATUS_VARIANTS: Record<string, 'warning' | 'info' | 'success'> = { none: 'warning', estimated: 'info', confirmed: 'success' }

/** The chips of a set of costs: status-only projection friendly (needs no amount). */
export function CostChips({ costs, today }: { costs: ReadonlyArray<CostRow | FullCostRow>; today: string }) {
  return <CostStatusBadges costs={badgeInputs(costs, today)} />
}

/**
 * Cost rows of an order line, subscription item or asset. Full projection: name, role, status, value (per month or
 * one-off), supplier, supplier term end, valid until and, for inventory costs, an Ended tag. Status-only projection:
 * name, role, status text and the Ended tag; never an amount.
 */
export function CostRowsTable({ costs, currency, today }: { costs: ReadonlyArray<CostRow | FullCostRow>; currency: string; today: string }) {
  const t = useT()
  const full = costs.some(isFullCostRow)
  return (
    <table className="w-full text-xs" data-testid="cpq-cost-rows">
      <thead>
        <tr className="text-muted-foreground">
          <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.name', 'Name')}</th>
          <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.role', 'Role')}</th>
          <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.status', 'Status')}</th>
          {full && <th className="py-1 text-right font-medium">{t('cpq.quoteCosts.value', 'Value')}</th>}
          {full && <th className="py-1 pl-2 text-left font-medium">{t('cpq.quoteCosts.supplier', 'Supplier')}</th>}
          {full && <th className="py-1 text-left font-medium">{t('cpq.inventoryCosts.supplierTermEnd', 'Supplier term end')}</th>}
          {full && <th className="py-1 text-left font-medium">{t('cpq.quoteCosts.validUntil', 'Valid until')}</th>}
        </tr>
      </thead>
      <tbody>
        {costs.map((cost) => {
          const row = isFullCostRow(cost) ? cost : null
          const value = row ? costValueView(row, currency) : null
          const expired = badgeInputs([cost], today)[0]?.expired
          return (
            <tr key={cost.id} className={`border-t border-dashed border-border/50 ${isEnded(cost) ? 'text-muted-foreground' : ''}`} data-testid="cpq-cost-row">
              <td className="py-1 font-medium">
                {cost.name}
                {row?.chargeCode && <span className="ml-1 font-mono font-normal text-muted-foreground">{row.chargeCode}</span>}
              </td>
              <td className="py-1">{t(`cpq.quoteCosts.roles.${cost.role}`, COST_ROLE_FALLBACKS[cost.role] ?? cost.role)}</td>
              <td className="py-1">
                <Tag variant={STATUS_VARIANTS[cost.valueStatus] ?? 'neutral'} className="px-1.5 text-xs">
                  {t(`cpq.quoteCosts.statuses.${cost.valueStatus}`, COST_STATUS_FALLBACKS[cost.valueStatus] ?? cost.valueStatus)}
                </Tag>
                {expired && <Tag variant="error" className="ml-1 px-1.5 text-xs">{t('cpq.quoteCosts.badges.expired', 'Expired cost')}</Tag>}
                {isEnded(cost) && <Tag variant="neutral" className="ml-1 px-1.5 text-xs" data-testid="cpq-cost-ended">{t('cpq.inventoryCosts.ended', 'Ended')}</Tag>}
              </td>
              {row && value && (
                <>
                  <td className="py-1 text-right font-mono" data-testid="cpq-cost-value">
                    {value.amount}
                    {value.period && <span className="ml-1 font-sans text-muted-foreground">{t(`cpq.inventoryCosts.period.${value.period}`, PERIOD_FALLBACKS[value.period])}</span>}
                  </td>
                  <td className="py-1 pl-2">{row.supplierName ?? '—'}</td>
                  <td className="py-1">{row.supplierTermEnd ?? '—'}</td>
                  <td className="py-1">{row.validUntil ?? '—'}</td>
                </>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
