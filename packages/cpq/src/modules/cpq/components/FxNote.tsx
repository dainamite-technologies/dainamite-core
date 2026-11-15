'use client'

import * as React from 'react'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'

/** A muted second line under a cost value ("≈ 276.00 EUR · 0.92 · ECB · 2026-11-11"); the tooltip explains the rate. */
export function FxNote({ text, tooltip, testId = 'cpq-cost-converted' }: { text: string; tooltip: string | null; testId?: string }) {
  const body = <span className="block font-sans text-xs font-normal text-muted-foreground" data-testid={testId}>{text}</span>
  return tooltip
    ? <SimpleTooltip content={tooltip} size="sm"><span className="cursor-help" tabIndex={0} aria-label={tooltip}>{body}</span></SimpleTooltip>
    : body
}
