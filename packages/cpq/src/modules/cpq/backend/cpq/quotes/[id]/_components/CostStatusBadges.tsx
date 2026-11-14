'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { COST_BADGE_FALLBACKS, lineCostBadges, type CostBadge, type RedactedQuoteCost } from '../../../../../lib/quoteCostView'

const VARIANTS: Record<CostBadge, 'warning' | 'info' | 'error'> = { pending: 'warning', estimated: 'info', expired: 'error' }

/** Per-line cost status badges for every user. Each carries its label as text, so colour is never the only signal. */
export function CostStatusBadges({ costs }: { costs: ReadonlyArray<Pick<RedactedQuoteCost, 'valueStatus' | 'expired'>> }) {
  const t = useT()
  const badges = lineCostBadges(costs)
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1" data-testid="cpq-cost-badges">
      {badges.map((badge) => (
        <Tag key={badge} variant={VARIANTS[badge]} dot className="px-1.5 text-xs" data-testid={`cpq-cost-badge-${badge}`}>
          {t(`cpq.quoteCosts.badges.${badge}`, COST_BADGE_FALLBACKS[badge])}
        </Tag>
      ))}
    </div>
  )
}
