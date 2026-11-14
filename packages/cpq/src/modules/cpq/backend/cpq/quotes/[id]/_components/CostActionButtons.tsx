'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Check, Pencil, Plus, Trash2, TrendingUp } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { FullQuoteCost } from '../../../../../lib/quoteCostView'
import { useQuoteCostsUi, type CostLineRef } from './quoteCostsContext'

/** Edit / Confirm / Delete for one cost row. Renders nothing without `cpq.costs.manage`. */
export function CostRowActions({ cost, line }: { cost: FullQuoteCost; line: CostLineRef }) {
  const t = useT()
  const actions = useQuoteCostsUi()?.actions
  if (!actions) return null
  const canConfirm = cost.valueStatus !== 'confirmed' && cost.unitAmount !== null
  return (
    <span className="inline-flex items-center gap-0.5">
      {canConfirm && (
        <IconButton variant="ghost" size="xs" aria-label={t('cpq.quoteCosts.actions.confirm', 'Confirm cost')} title={t('cpq.quoteCosts.actions.confirm', 'Confirm cost')}
          onClick={() => actions.confirm(cost, line)} data-testid="cpq-cost-confirm">
          <Check className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton variant="ghost" size="xs" aria-label={t('cpq.quoteCosts.actions.edit', 'Edit cost')} title={t('cpq.quoteCosts.actions.edit', 'Edit cost')}
        onClick={() => actions.edit(cost, line)} data-testid="cpq-cost-edit">
        <Pencil className="h-3.5 w-3.5" />
      </IconButton>
      {cost.origin === 'manual' && (
        <IconButton variant="ghost" size="xs" aria-label={t('cpq.quoteCosts.actions.delete', 'Delete cost')} title={t('cpq.quoteCosts.actions.delete', 'Delete cost')}
          onClick={() => actions.remove(cost)} data-testid="cpq-cost-delete">
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </span>
  )
}

/** Add cost / Override markup in the panel header. Renders nothing without `cpq.costs.manage`. */
export function CostHeaderActions({ line }: { line: CostLineRef }) {
  const t = useT()
  const ui = useQuoteCostsUi()
  if (!ui?.actions) return null
  const hasCostPlus = (ui.chargesFor?.(line.lineId) ?? []).some((charge) => charge.pricingMethod === 'cost_plus')
  return (
    <span className="inline-flex items-center gap-1">
      {hasCostPlus && (
        <Button variant="outline" size="sm" onClick={() => ui.actions?.overrideMarkup(line)} data-testid="cpq-override-markup">
          <TrendingUp className="mr-1 h-3.5 w-3.5" aria-hidden />{t('cpq.quoteCosts.actions.overrideMarkup', 'Override markup')}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => ui.actions?.add(line)} data-testid="cpq-add-cost">
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />{t('cpq.quoteCosts.actions.add', 'Add cost')}
      </Button>
    </span>
  )
}
