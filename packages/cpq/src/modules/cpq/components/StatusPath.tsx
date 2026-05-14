"use client"
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { TagMap } from '@open-mercato/ui/primitives/tag'
import { formatStatusLabel } from './statusMaps'

// Generic horizontal status breadcrumb shared by quotes, orders,
// subscriptions, and assets. Each consumer passes its own `path`
// (happy-path order) + `terminals` (off-path failure / cancellation
// states always rendered at the end) + `statusMap` (status → Tag
// variant for colours).
//
// Two interaction modes:
//   - read-only: omit `onTransition`. Path renders as a progress
//     indicator only.
//   - interactive: pass `onTransition`. Every non-current step
//     becomes a button that calls `onTransition(target)`. If
//     `allowedTransitions` is provided, only those targets are
//     clickable; otherwise all non-current steps are clickable.

type TagVariant = TagMap<string>[string]

export function StatusPath({
  current,
  path: happyPath,
  terminals = [],
  statusMap,
  labels,
  onTransition,
  allowedTransitions,
  disabled,
  ariaLabel = 'Status path',
}: {
  current: string
  /** Happy-path statuses in order. */
  path: string[]
  /** Off-path terminal statuses always rendered after the happy path. */
  terminals?: string[]
  /** Status → Tag variant. Missing entries fall back to "neutral". */
  statusMap: Record<string, TagVariant>
  /** Optional human labels (overrides `formatStatusLabel`). */
  labels?: Record<string, string>
  /** Click handler. Omit for read-only path. */
  onTransition?: (target: string) => void
  /** If set, only these targets are clickable. Else any non-current. */
  allowedTransitions?: string[]
  disabled?: boolean
  ariaLabel?: string
}) {
  // Build the displayed sequence. Aliases can swap into the happy
  // path slot (e.g. quote's `pre_approved` shown as `approved`). We
  // don't handle aliasing here — consumers can swap entries in
  // their own happyPath before passing it in.
  const sequence = React.useMemo<string[]>(
    () => [...happyPath, ...terminals],
    [happyPath, terminals],
  )

  const currentIdx = sequence.findIndex((s) => s === current)
  const interactiveMode = typeof onTransition === 'function'

  return (
    <nav aria-label={ariaLabel} className="flex items-center gap-1.5 flex-wrap text-xs">
      {sequence.map((status, idx) => {
        const reached = currentIdx >= 0 && idx <= currentIdx
        const isCurrent = status === current
        const variant = statusMap[status] ?? 'neutral'
        const label = labels?.[status] ?? formatStatusLabel(status)
        const tagClass = isCurrent
          ? 'ring-2 ring-primary/40'
          : reached
            ? ''
            : 'opacity-60'
        // Clickability: interactive mode + not current + not disabled
        // + (no allowedTransitions list OR status is in the list).
        const clickable =
          interactiveMode &&
          !isCurrent &&
          !disabled &&
          (allowedTransitions ? allowedTransitions.includes(status) : true)
        const wrapperClass = clickable
          ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 rounded-full'
          : ''

        return (
          <React.Fragment key={status}>
            {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            {clickable ? (
              <button
                type="button"
                onClick={() => onTransition!(status)}
                aria-current={isCurrent ? 'step' : undefined}
                title={`Transition to ${label}`}
                className={wrapperClass}
              >
                <Tag variant={variant} dot={isCurrent} className={tagClass}>
                  {label}
                </Tag>
              </button>
            ) : (
              <Tag
                variant={variant}
                dot={isCurrent}
                className={tagClass}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {label}
              </Tag>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}
