"use client"
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  formatStatusLabel,
  quoteCpqStatusMap,
  type QuoteCpqStatus,
} from '../../../../../components/statusMaps'

// The canonical happy-path through quote states, followed by the two
// off-path terminals. We expose all of them as clickable steps so the
// operator can transition between any pair (backend stays the single
// source of truth for what's legal — the UI no longer gates).
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

const OFF_PATH_TERMINALS: string[] = ['rejected', 'cancelled']

export function QuoteStatusPath({
  current,
  onTransition,
  disabled,
}: {
  current: string
  /**
   * Per product requirement: every step is clickable and can transition to
   * any other step. The `allowedTransitions` prop has been intentionally
   * removed so the component never gates the operator's choice — backend
   * is the single source of truth for what's legal.
   */
  onTransition: (target: string) => void
  disabled?: boolean
}) {
  // Build the displayed path: full happy path + the two off-path
  // terminals, always rendered so the operator can jump to any state.
  // `pre_approved` aliases into the `approved` slot when current.
  const path = React.useMemo<string[]>(() => {
    const base = [...HAPPY_PATH]
    if (current === 'pre_approved') {
      const idx = base.indexOf('approved')
      if (idx >= 0) base.splice(idx, 1, 'pre_approved')
    }
    return [...base, ...OFF_PATH_TERMINALS]
  }, [current])

  const currentIdx = path.findIndex((s) => s === current)

  return (
    <nav aria-label="Quote status path" className="flex items-center gap-1.5 flex-wrap text-xs">
      {path.map((status, idx) => {
        const reached = currentIdx >= 0 && idx <= currentIdx
        const isCurrent = status === current
        // Every non-current step is clickable. The current step has no
        // self-transition, so it stays inert but still highlighted.
        const interactive = !isCurrent && !disabled
        const variant = quoteCpqStatusMap[status as QuoteCpqStatus] ?? 'neutral'
        const label = formatStatusLabel(status)
        const tagClass = isCurrent
          ? 'ring-2 ring-primary/40'
          : reached
            ? ''
            : 'opacity-60'
        const wrapperClass = interactive
          ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 rounded-full'
          : ''

        return (
          <React.Fragment key={status}>
            {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            <button
              type="button"
              onClick={interactive ? () => onTransition(status) : undefined}
              disabled={!interactive}
              aria-current={isCurrent ? 'step' : undefined}
              title={interactive ? `Transition to ${label}` : undefined}
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
