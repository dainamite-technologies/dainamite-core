"use client"
import * as React from 'react'
import Link from 'next/link'
import { Building2, User } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CustomerKind } from '../data/validators'
import { customerDetailHref } from '../lib/customerLookup'

/**
 * Customer reference for billing views (Spec E): kind icon + resolved
 * display name, falling back to the raw id when the customers lookup is
 * unavailable. `linkToCustomer` turns the name into a link to the customer
 * record in the customers module.
 */
export function CustomerLabel({
  customerId,
  customerKind,
  name,
  linkToCustomer = false,
}: {
  customerId: string
  customerKind: CustomerKind
  name?: string | null
  linkToCustomer?: boolean
}) {
  const t = useT()
  const kindLabel =
    customerKind === 'person'
      ? t('billing.accounts.kind.person', 'Person')
      : t('billing.accounts.kind.company', 'Company')
  const Icon = customerKind === 'person' ? User : Building2
  const text = name ? (
    <span>{name}</span>
  ) : (
    <span className="font-mono text-xs">{customerId}</span>
  )
  return (
    <span className="inline-flex items-center gap-1.5" title={kindLabel}>
      <Icon size={14} aria-label={kindLabel} className="shrink-0 text-muted-foreground" />
      {linkToCustomer ? (
        <Link
          href={customerDetailHref(customerKind, customerId)}
          className="underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {text}
        </Link>
      ) : (
        text
      )}
    </span>
  )
}
