'use client'

import * as React from 'react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'

/**
 * Icon-only row action (quote line and charge rows): muted like its
 * neighbours, with a tooltip and an aria-label from the same text.
 * `className` adds hover colours (e.g. destructive on Remove); IconButton
 * merges them over the muted defaults.
 */
export function IconAction({ label, onClick, size = 'sm', className, disabled, children, ...rest }: {
  label: string
  onClick: () => void
  size?: 'xs' | 'sm'
  className?: string
  /** Disabled actions show no tooltip here; wrap them in a blocked-reason tooltip instead. */
  disabled?: boolean
  children: React.ReactNode
  'data-testid'?: string
}) {
  return (
    <SimpleTooltip content={label} size="sm" disabled={disabled}>
      <IconButton
        type="button" variant="ghost" size={size} aria-label={label} disabled={disabled} onClick={onClick}
        className={`text-muted-foreground hover:text-foreground ${className ?? ''}`} {...rest}
      >
        {children}
      </IconButton>
    </SimpleTooltip>
  )
}
