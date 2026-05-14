"use client"
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  formatStatusLabel,
  orderCpqStatusMap,
  type OrderCpqStatus,
} from '../../../../../components/statusMaps'

// Order happy-path. Off-path terminal `cancelled` is always rendered at
// the end of the breadcrumb so the lifecycle is visible at a glance.
//
// Unlike the quote status path this is purely a progress indicator —
// orders gain real state via the dedicated `Activate` / `Cancel` buttons,
// which run backend side effects (subscription / asset creation). A
// click-to-jump path here would be a footgun.
const HAPPY_PATH: string[] = ['draft', 'pending_activation', 'active', 'fulfilled']
const OFF_PATH_TERMINALS: string[] = ['cancelled']

export function OrderStatusPath({ current }: { current: string }) {
  const path = React.useMemo<string[]>(
    () => [...HAPPY_PATH, ...OFF_PATH_TERMINALS],
    [],
  )
  const currentIdx = path.findIndex((s) => s === current)

  return (
    <nav aria-label="Order status path" className="flex items-center gap-1.5 flex-wrap text-xs">
      {path.map((status, idx) => {
        const reached = currentIdx >= 0 && idx <= currentIdx
        const isCurrent = status === current
        const variant = orderCpqStatusMap[status as OrderCpqStatus] ?? 'neutral'
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
