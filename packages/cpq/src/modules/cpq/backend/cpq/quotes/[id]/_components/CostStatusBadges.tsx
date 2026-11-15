'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { COST_BADGE_FALLBACKS, lineCostBadges, type CostBadge, type RedactedQuoteCost } from '../../../../../lib/quoteCostView'
import { SOURCING_BADGE_FALLBACKS, sourcingBadges, type SourcingBadge } from '../../../../../lib/costSourcingView'

const VARIANTS: Record<CostBadge, 'warning' | 'info' | 'error'> = { pending: 'warning', estimated: 'info', expired: 'error' }
const SOURCING_VARIANTS: Record<SourcingBadge, 'warning' | 'info' | 'error'> = { requested: 'info', overdue: 'error', declined: 'error', answerPending: 'warning' }

/** Per-line cost status badges for every user. Each carries its label as text, so colour is never the only signal. */
export function CostStatusBadges({ costs }: { costs: ReadonlyArray<Pick<RedactedQuoteCost, 'valueStatus' | 'expired' | 'sourcingStatus' | 'hasAnswerPending' | 'overdue'>> }) {
  const t = useT()
  const badges = lineCostBadges(costs)
  const sourcing = sourcingBadges(costs)
  if (badges.length === 0 && sourcing.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1" data-testid="cpq-cost-badges">
      {badges.map((badge) => (
        <Tag key={badge} variant={VARIANTS[badge]} dot className="px-1.5 text-xs" data-testid={`cpq-cost-badge-${badge}`}>
          {t(`cpq.quoteCosts.badges.${badge}`, COST_BADGE_FALLBACKS[badge])}
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
