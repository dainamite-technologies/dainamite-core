"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDay } from '../lib/displayDate'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { billedBeyond, previewCredit, type CreditPreviewItem } from '../lib/creditPreview'
import { CREDIT_REASON_TEXT_MAX } from '../lib/creditReason'

/** True when ending `item` on `newEndDate` needs a customer-facing reason (Part 2, D9). */
export function isCreditReasonRequired(item: CreditPreviewItem, newEndDate: string | null): boolean {
  return previewCredit(item, newEndDate).credited
}

/**
 * Billed-through info + credit warning + required reason, shared by the
 * "Change price" dialog and the item form's end-date edit. Renders nothing
 * for non-recurring items.
 */
export function CreditReasonField({
  item,
  newEndDate,
  value,
  onChange,
}: {
  item: CreditPreviewItem
  /** The item's new last day (YYYY-MM-DD), or null when it stays open-ended. */
  newEndDate: string | null
  value: string
  onChange: (value: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  if (item.type !== 'recurring') return null
  const preview = previewCredit(item, newEndDate)
  const keepsBilledDays = !preview.credited && billedBeyond(item, newEndDate)
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="text-xs text-muted-foreground">
        {item.billedToDate
          ? t('billing.items.credit.billed_through', 'Billed through {date}', { date: formatBillingDay(item.billedToDate, locale) })
          : t('billing.items.credit.not_billed', 'Not billed yet')}
      </span>
      {preview.credited ? (
        <>
          <Alert status="warning" size="sm">
            <AlertDescription>
              {t(
                'billing.items.credit.warning',
                'This item is billed through {billedTo}. The next invoice credits {from} – {to} ({days} days) — give the customer a reason.',
                {
                  billedTo: formatBillingDay(preview.to, locale),
                  from: formatBillingDay(preview.from, locale),
                  to: formatBillingDay(preview.to, locale),
                  days: preview.days,
                },
              )}
            </AlertDescription>
          </Alert>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">
              {t('billing.items.credit.reason', 'Reason (shown on the invoice)')}
              <span className="text-destructive"> *</span>
            </span>
            <Textarea
              rows={2}
              maxLength={CREDIT_REASON_TEXT_MAX}
              value={value}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
            <span className="self-end text-xs text-muted-foreground tabular-nums">
              {value.length}/{CREDIT_REASON_TEXT_MAX}
            </span>
          </label>
        </>
      ) : keepsBilledDays ? (
        <Alert status="information" size="sm">
          <AlertDescription>
            {t(
              'billing.items.credit.no_prorate',
              'Days already billed stay at the old terms (proration is off); nothing is credited.',
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
