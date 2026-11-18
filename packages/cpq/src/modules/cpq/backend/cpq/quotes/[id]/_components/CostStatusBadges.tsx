'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { COST_BADGE_FALLBACKS, lineCostBadges, type CostBadge, type RedactedQuoteCost } from '../../../../../lib/quoteCostView'
import { pendingIsRateOnly } from '../../../../../lib/fxView'
import { hasIndexNoValue, INDEX_NO_VALUE_FALLBACK } from '../../../../../lib/indexView'
import { ARC_COST_BADGE_FALLBACKS, arcCostBadges, type ArcCostBadge } from '../../../../../lib/arcCostView'
import { SOURCING_BADGE_FALLBACKS, sourcingBadges, type SourcingBadge } from '../../../../../lib/costSourcingView'

const VARIANTS: Record<CostBadge, 'warning' | 'info' | 'error'> = { pending: 'warning', estimated: 'info', expired: 'error' }
const ARC_VARIANTS: Record<ArcCostBadge, 'neutral' | 'warning'> = { carried: 'neutral', renegotiationDue: 'warning' }
const SOURCING_VARIANTS: Record<SourcingBadge, 'warning' | 'info' | 'error'> = { requested: 'info', overdue: 'error', declined: 'error', answerPending: 'warning' }

/** Per-line cost status badges for every user. Each carries its label as text, so colour is never the only signal. */
export function CostStatusBadges({ costs }: { costs: ReadonlyArray<Pick<RedactedQuoteCost, 'valueStatus' | 'expired' | 'sourcingStatus' | 'hasAnswerPending' | 'overdue' | 'error' | 'carried' | 'renegotiationDue'>> }) {
  const t = useT()
  const badges = lineCostBadges(costs)
  // A line pending only for a missing rate reads "Cost pending — currency rate missing" (no currencies: the redacted view has none).
  const rateOnly = pendingIsRateOnly(costs)
  const sourcing = sourcingBadges(costs)
  const arc = arcCostBadges(costs)
  // An index cost with no value in force: status only (the redacted view carries the code, never an index or amount).
  const indexNoValue = costs.some(hasIndexNoValue)
  if (badges.length === 0 && !indexNoValue && sourcing.length === 0 && arc.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1" data-testid="cpq-cost-badges">
      {badges.map((badge) => (
        <Tag key={badge} variant={VARIANTS[badge]} dot className="px-1.5 text-xs" data-testid={`cpq-cost-badge-${badge === 'pending' && rateOnly ? 'fxMissing' : badge}`}>
          {badge === 'pending' && rateOnly
            ? t('cpq.quoteCosts.badges.fxMissing', 'Cost pending — currency rate missing')
            : t(`cpq.quoteCosts.badges.${badge}`, COST_BADGE_FALLBACKS[badge])}
        </Tag>
      ))}
      {indexNoValue && (
        <Tag variant="warning" dot className="px-1.5 text-xs" data-testid="cpq-cost-badge-indexNoValue">
          {t('cpq.quoteCosts.badges.indexNoValue', INDEX_NO_VALUE_FALLBACK)}
        </Tag>
      )}
      {arc.map((badge) => (
        <Tag key={badge} variant={ARC_VARIANTS[badge]} dot className="px-1.5 text-xs" data-testid={`cpq-cost-badge-${badge}`}>
          {t(`cpq.quoteCosts.badges.${badge}`, ARC_COST_BADGE_FALLBACKS[badge])}
        </Tag>
      ))}
      {sourcing.map((badge) => (
        <Tag key={badge} variant={SOURCING_VARIANTS[badge]} dot className="px-1.5 text-xs" data-testid={`cpq-cost-badge-${badge}`}>
          {t(`cpq.quoteCosts.sourcingBadges.${badge}`, SOURCING_BADGE_FALLBACKS[badge])}
        </Tag>
      ))}
    </div>
  )
}
