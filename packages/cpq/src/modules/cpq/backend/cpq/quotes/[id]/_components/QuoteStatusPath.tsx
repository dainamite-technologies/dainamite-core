"use client"
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  formatStatusLabel,
  quoteCpqStatusMap,
  type QuoteCpqStatus,
} from '../../../../../components/statusMaps'

// The canonical happy-path through quote states. Off-path terminal states
// (`rejected`, `cancelled`) replace the trailing "accepted" pill when the
// quote actually lands there, so the breadcrumb still ends on the row.
// `pre_approved` is rendered in the `approved` slot as a visual alias.
const HAPPY_PATH: string[] = [
  'new',
  'incomplete',
  'ready',
  'in_approval',
  'approved',
  'with_customer',
  'accepted',
]

const FALLBACK_TERMINAL = ['rejected', 'cancelled'] as const

export function QuoteStatusPath({
  current,
  allowedTransitions,
  onTransition,
  disabled,
}: {
  current: string
  allowedTransitions: string[]
  onTransition: (target: string) => void
  disabled?: boolean
}) {
  // Build the displayed path. If the current state is off the happy path
  // (e.g. `rejected`), swap it into the trailing slot so the breadcrumb
  // still ends on the row.
  const path = React.useMemo<string[]>(() => {
    const base = [...HAPPY_PATH]
    if (current === 'pre_approved') {
      const idx = base.indexOf('approved')
      if (idx >= 0) base.splice(idx, 1, 'pre_approved')
    } else if (!base.includes(current) && (FALLBACK_TERMINAL as readonly string[]).includes(current)) {
      base[base.length - 1] = current
    }
    return base
  }, [current])

  const currentIdx = path.findIndex((s) => s === current)

  return (
    <nav aria-label="Quote status path" className="flex items-center gap-1.5 flex-wrap text-xs">
      {path.map((status, idx) => {
        const reached = currentIdx >= 0 && idx <= currentIdx
        const isCurrent = status === current
        const isTransitionable = allowedTransitions.includes(status)
        const variant = quoteCpqStatusMap[status as QuoteCpqStatus] ?? 'neutral'
        const label = formatStatusLabel(status)
        const tagClass = isCurrent
          ? 'ring-2 ring-primary/40'
          : reached
            ? ''
            : 'opacity-50'
        const wrapperClass = isTransitionable && !disabled
          ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 rounded-full'
          : ''
        const interactive = isTransitionable && !disabled

        return (
          <React.Fragment key={status}>
            {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            <button
              type="button"
              onClick={interactive ? () => onTransition(status) : undefined}
              disabled={!interactive}
              aria-current={isCurrent ? 'step' : undefined}
              className={`${wrapperClass} ${interactive ? '' : 'cursor-default'}`}
            >
              <Tag variant={variant} dot={isCurrent} className={tagClass}>
                {label}
              </Tag>
            </button>
          </React.Fragment>
        )
      })}
    </nav>
  )
}
