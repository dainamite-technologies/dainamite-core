"use client"
import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'

/**
 * Amber callout at the top of the Billing tab of an ARC `amend` / `cancel`
 * order whose earliest activation date is still ahead (Part 2, 6c). The
 * activation guard rejects an earlier activation with 422.
 */
export function EarliestActivationNotice({ date }: { date: string }) {
  const t = useT()
  const locale = useLocale()
  const formatted = React.useMemo(() => {
    const parsed = new Date(`${date}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime())) return date
    // Date-only value: format in UTC so no timezone shifts it by a day.
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(parsed)
  }, [date, locale])
  return (
    <Alert status="warning">
      <AlertDescription>
        {t(
          'cpq_billing_connector.orderSetup.earliestActivation',
          'This amendment can be activated from {date}, when billing for this subscription starts. Activating earlier is blocked.',
          { date: formatted },
        )}
      </AlertDescription>
    </Alert>
  )
}
