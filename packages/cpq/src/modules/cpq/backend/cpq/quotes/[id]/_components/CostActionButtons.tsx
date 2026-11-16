'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Check, CircleCheck, Handshake, CircleX, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2, TrendingUp, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { FullQuoteCost } from '../../../../../lib/quoteCostView'
import { sourcingActions } from '../../../../../lib/costSourcingView'
import { useQuoteCostsUi, type CostLineRef } from './quoteCostsContext'
import { useArcCostActionsUi } from './arcCostActions'

/**
 * Supplier sourcing actions of one cost row: Request / Re-request / Cancel request (`cpq.quotes.manage`),
 * Answer / Decline (`cpq.costs.view` + `cpq.costs.manage`), Reopen and apply supplier answer (quote + costs manage).
 * Which ones render is `sourcingActions`' decision (permissions, request state, eligibility, closed quote).
 */
export function CostSourcingRowActions({ cost, line }: { cost: FullQuoteCost; line: CostLineRef }) {
  const t = useT()
  const sourcing = useQuoteCostsUi()?.sourcing
  if (!sourcing) return null
  const visible = sourcingActions(cost, { closed: sourcing.closed, permissions: sourcing.permissions })
  if (visible.length === 0) return null
  const { handlers } = sourcing
  const label = {
    request: t('cpq.quoteCosts.actions.request', 'Request cost'),
    rerequest: t('cpq.quoteCosts.actions.rerequest', 'Re-request'),
    cancel: t('cpq.quoteCosts.actions.cancelRequest', 'Cancel request'),
    answer: t('cpq.quoteCosts.actions.answer', 'Answer'),
    decline: t('cpq.quoteCosts.actions.decline', 'Decline'),
    apply: t('cpq.quoteCosts.actions.apply', 'Reopen and apply supplier answer'),
  }
  const button = (id: (typeof visible)[number], icon: React.ReactNode, onClick: () => void) => visible.includes(id) && (
    <IconButton key={id} variant="ghost" size="xs" aria-label={label[id]} title={label[id]} onClick={onClick} data-testid={`cpq-cost-${id}`}>{icon}</IconButton>
  )
  return (
    <span className="inline-flex items-center gap-0.5" data-testid="cpq-cost-sourcing-actions">
      {button('request', <Send className="h-3.5 w-3.5" />, () => handlers.request(cost))}
      {button('rerequest', <RefreshCw className="h-3.5 w-3.5" />, () => handlers.request(cost))}
      {button('cancel', <X className="h-3.5 w-3.5" />, () => handlers.cancel(cost))}
      {button('answer', <CircleCheck className="h-3.5 w-3.5" />, () => handlers.answer(cost, line))}
      {button('decline', <CircleX className="h-3.5 w-3.5" />, () => handlers.decline(cost, line))}
      {button('apply', <RotateCcw className="h-3.5 w-3.5" />, () => handlers.apply(cost))}
    </span>
  )
}

/** Edit / Confirm / Delete for one cost row (renders nothing without `cpq.costs.manage`), plus the sourcing actions. */
export function CostRowActions({ cost, line }: { cost: FullQuoteCost; line: CostLineRef }) {
  const t = useT()
  const actions = useQuoteCostsUi()?.actions
  const arc = useArcCostActionsUi()
  if (!actions) return <CostSourcingRowActions cost={cost} line={line} />
  const canConfirm = cost.valueStatus !== 'confirmed' && cost.unitAmount !== null
  return (
    <span className="inline-flex items-center gap-0.5">
      <CostSourcingRowActions cost={cost} line={line} />
      {arc?.keepCurrentVisible(cost) && (
        <IconButton variant="ghost" size="xs" aria-label={t('cpq.arc.keepCurrent.action', 'Keep current cost')} title={t('cpq.arc.keepCurrent.action', 'Keep current cost')}
          onClick={() => arc.keepCurrent(cost, line)} data-testid="cpq-cost-keep-current">
          <Handshake className="h-3.5 w-3.5" />
        </IconButton>
      )}
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
