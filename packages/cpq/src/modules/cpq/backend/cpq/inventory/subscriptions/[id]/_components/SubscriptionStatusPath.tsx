"use client"
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  formatStatusLabel,
  subscriptionStatusMap,
  type SubscriptionStatus,
} from '../../../../../../components/statusMaps'

// Subscription happy-path. Terminated / expired / suspended are off-path
// terminals always rendered so the lifecycle is visible at a glance.
// Read-only (like the order one) — transitions happen through dedicated
// actions (Activate, Suspend, Terminate) elsewhere on the page.
const HAPPY_PATH: string[] = ['pending', 'active']
const OFF_PATH_TERMINALS: string[] = ['suspended', 'terminated', 'expired']

export function SubscriptionStatusPath({ current }: { current: string }) {
  const path = React.useMemo<string[]>(
    () => [...HAPPY_PATH, ...OFF_PATH_TERMINALS],
    [],
  )
  const currentIdx = path.findIndex((s) => s === current)

  return (
    <nav aria-label="Subscription status path" className="flex items-center gap-1.5 flex-wrap text-xs">
      {path.map((status, idx) => {
        const reached = currentIdx >= 0 && idx <= currentIdx
        const isCurrent = status === current
        const variant = subscriptionStatusMap[status as SubscriptionStatus] ?? 'neutral'
        const tagClass = isCurrent ? 'ring-2 ring-primary/40' : reached ? '' : 'opacity-60'
        return (
          <React.Fragment key={status}>
            {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            <Tag variant={variant} dot={isCurrent} className={tagClass}>
              {formatStatusLabel(status)}
            </Tag>
          </React.Fragment>
        )
      })}
    </nav>
  )
}
