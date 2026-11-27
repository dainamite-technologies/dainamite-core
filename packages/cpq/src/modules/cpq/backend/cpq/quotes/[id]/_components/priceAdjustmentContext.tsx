'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Pencil, Percent, Trash2 } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import type { AdjustmentAccess, LineEligibilityInput, WaterfallChargeInput } from '../../../../../lib/priceAdjustmentView'
import { lineAdjustmentBlock } from '../../../../../lib/priceAdjustmentView'

export type AdjustableLine = LineEligibilityInput & { lineId: string; offeringName: string; termMonths?: number | null }
export type AdjustableCharge = WaterfallChargeInput & { chargeCode: string; chargeName: string }

export type PriceAdjustmentUi = {
  access: AdjustmentAccess
  quoteType: string
  cpqStatus: string
  reasonLabels: Record<string, string>
  /** Ids of adjustments currently flagged invalid (they keep Delete while locked). */
  invalidIds: Set<string>
  canDeleteInvalid: boolean
  /** Price dialog on the line's default target, or on one charge. */
  openPrice: (line: AdjustableLine, charge?: AdjustableCharge) => void
  /** Price dialog on the target of a stored row. */
  edit: (adjustmentId: string) => void
  /** Removes the row's whole target (PUT); on a locked quote only the invalid rows (per-row DELETE). */
  remove: (adjustmentId: string) => void
}

const Context = React.createContext<PriceAdjustmentUi | null>(null)
export const PriceAdjustmentProvider = Context.Provider
export const usePriceAdjustmentUi = () => React.useContext(Context)

/** Quote-wide explanation for why adjustments are unavailable; null when editable. */
export function useAccessReasonText(): string | null {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  if (!ui) return null
  switch (ui.access.reason) {
    case null: return null
    case 'locked':
      return t('cpq.priceAdjustments.blocked.locked', 'Adjustments are locked in status {status} — move the quote back to Ready to change them')
        .replace('{status}', ui.cpqStatus)
    case 'converted': return t('cpq.priceAdjustments.blocked.converted', 'This quote has been converted to an order')
    case 'no_permission': return t('cpq.priceAdjustments.blocked.permission', 'You do not have permission to adjust prices')
    case 'disabled': return t('cpq.priceAdjustments.blocked.disabled', 'Manual price adjustments are turned off')
    default: return t('cpq.priceAdjustments.blocked.loading', 'Loading…')
  }
}

/** Disabled-state explanation for one line; null when the action is available. */
export function useAdjustmentBlockReason(line: AdjustableLine): string | null {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  const accessText = useAccessReasonText()
  if (!ui) return null
  const block = lineAdjustmentBlock(line, ui.quoteType)
  if (block === 'mirror') return t('cpq.priceAdjustments.blocked.mirror', 'Price changes on existing subscription items arrive with a later release')
  if (block === 'free_form') return t('cpq.priceAdjustments.blocked.freeForm', 'Free-form lines cannot be adjusted')
  return accessText
}

/**
 * Disabled buttons swallow no pointer events, so a native `title` never shows.
 * Wrap a blocked action in a focusable span that carries the explanation.
 */
function BlockedReason({ reason, children }: { reason: string | null; children: React.ReactNode }) {
  if (!reason) return <>{children}</>
  return (
    <SimpleTooltip content={reason} size="sm">
      <span className="inline-flex cursor-not-allowed" tabIndex={0} aria-label={reason}>{children}</span>
    </SimpleTooltip>
  )
}

/**
 * The one "Adjust price" action (§4.1): an icon-only `Percent` button on the
 * line and on each non-usage charge, opening the Price dialog on the line's
 * default target or on that charge. Hidden when the feature is off or not
 * permitted; otherwise disabled with the reason (locked, ARC mirror, free-form).
 */
export function AdjustPriceAction({ line, charge }: { line: AdjustableLine; charge?: AdjustableCharge }) {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  const reason = useAdjustmentBlockReason(line)
  if (!ui || charge?.chargeType === 'usage') return null
  if (ui.access.reason === 'disabled' || ui.access.reason === 'no_permission' || ui.access.reason === 'loading') return null
  const label = t('cpq.priceAdjustments.adjustPrice', 'Adjust price')
  return (
    <BlockedReason reason={reason}>
      <SimpleTooltip content={label} size="sm" disabled={!!reason}>
        <IconButton
          type="button" variant="ghost" size={charge ? 'xs' : 'sm'} aria-label={label} disabled={!!reason}
          onClick={() => ui.openPrice(line, charge)} data-testid={charge ? 'cpq-adjust-price-charge' : 'cpq-adjust-price-line'}
        >
          <Percent className={charge ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </IconButton>
      </SimpleTooltip>
    </BlockedReason>
  )
}

/** Edit / delete actions on a manual waterfall row or panel row. */
export function ManualAdjustmentActions({ adjustmentId }: { adjustmentId: string }) {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  if (!ui) return null
  const editable = ui.access.editable
  const deletable = editable || (ui.canDeleteInvalid && ui.invalidIds.has(adjustmentId))
  if (!editable && !deletable) return null
  return (
    <span className="inline-flex items-center gap-0.5">
      {editable && (
        <IconButton variant="ghost" size="xs" aria-label={t('cpq.priceAdjustments.edit', 'Edit adjustment')} onClick={() => ui.edit(adjustmentId)}>
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton variant="ghost" size="xs" aria-label={t('cpq.priceAdjustments.delete', 'Delete adjustment')} onClick={() => ui.remove(adjustmentId)}>
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </span>
  )
}
