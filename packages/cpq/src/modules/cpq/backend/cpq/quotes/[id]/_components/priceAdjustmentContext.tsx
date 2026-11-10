'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Percent, Pencil, Trash2 } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { AdjustmentAccess, LineEligibilityInput, WaterfallChargeInput } from '../../../../../lib/priceAdjustmentView'
import { lineAdjustmentBlock } from '../../../../../lib/priceAdjustmentView'

export type AdjustableLine = LineEligibilityInput & { lineId: string; offeringName: string }
export type AdjustableCharge = WaterfallChargeInput & { chargeCode: string; chargeName: string }

export type PriceAdjustmentUi = {
  access: AdjustmentAccess
  quoteType: string
  cpqStatus: string
  reasonLabels: Record<string, string>
  /** Ids of adjustments currently flagged invalid (they keep Delete while locked). */
  invalidIds: Set<string>
  canDeleteInvalid: boolean
  openCharge: (line: AdjustableLine, charge: AdjustableCharge) => void
  openLine: (line: AdjustableLine) => void
  edit: (adjustmentId: string) => void
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

/** Per-charge "Adjust price" action. Hidden entirely when the feature is off or not permitted. */
export function AdjustChargeAction({ line, charge }: { line: AdjustableLine; charge: AdjustableCharge }) {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  const reason = useAdjustmentBlockReason(line)
  if (!ui || charge.chargeType === 'usage') return null
  if (ui.access.reason === 'disabled' || ui.access.reason === 'no_permission' || ui.access.reason === 'loading') return null
  const label = t('cpq.priceAdjustments.adjustPrice', 'Adjust price')
  return (
    <IconButton
      variant="ghost" size="xs" aria-label={label} title={reason ?? label} disabled={!!reason}
      onClick={() => ui.openCharge(line, charge)} data-testid="cpq-adjust-charge"
    >
      <Pencil className="h-3.5 w-3.5" />
    </IconButton>
  )
}

/** Line-level "Discount line" action. */
export function DiscountLineAction({ line }: { line: AdjustableLine }) {
  const t = useT()
  const ui = usePriceAdjustmentUi()
  const reason = useAdjustmentBlockReason(line)
  if (!ui || ui.access.reason === 'disabled' || ui.access.reason === 'no_permission' || ui.access.reason === 'loading') return null
  const label = t('cpq.priceAdjustments.discountLine', 'Discount line')
  return (
    <IconButton
      variant="ghost" size="sm" aria-label={label} title={reason ?? label} disabled={!!reason}
      onClick={() => ui.openLine(line)} data-testid="cpq-discount-line"
    >
      <Percent className="h-4 w-4" />
    </IconButton>
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
