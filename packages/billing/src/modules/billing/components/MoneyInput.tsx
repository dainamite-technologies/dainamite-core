"use client"
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'

export type MoneyInputProps = Omit<React.ComponentProps<typeof Input>, 'type'> & {
  /** ISO currency code shown as a read-only suffix; nothing is shown when empty. */
  currencyCode?: string | null
}

/**
 * Number input with a read-only currency suffix (Spec F, F2). The currency
 * comes from the parent Billing Account and is never editable here.
 */
export function MoneyInput({ currencyCode, className, ...inputProps }: MoneyInputProps) {
  const code = currencyCode?.trim()
  return (
    <div className="relative">
      <Input type="number" {...inputProps} className={code ? `pr-14 ${className ?? ''}` : className} />
      {code ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
          {code}
        </span>
      ) : null}
    </div>
  )
}
