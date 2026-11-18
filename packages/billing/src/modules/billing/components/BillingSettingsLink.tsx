"use client"
import * as React from 'react'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

/** Route of the billing settings page (seller, bank, terms, numbering, prepaid). */
export const BILLING_SETTINGS_HREF = '/backend/config/billing'

/**
 * Header shortcut to the billing settings page (Spec F, F6). The target page
 * enforces `billing.settings.view` itself, so the link is not gated here.
 */
export function BillingSettingsLink() {
  const t = useT()
  return (
    <Button asChild variant="outline">
      <Link href={BILLING_SETTINGS_HREF}>
        <Settings size={16} />
        {t('billing.settings.link', 'Billing settings')}
      </Link>
    </Button>
  )
}
