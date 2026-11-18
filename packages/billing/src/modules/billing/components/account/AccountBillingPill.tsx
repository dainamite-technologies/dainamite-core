"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDay } from '../../lib/displayDate'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  accountBillingState,
  accountBillingTone,
  type AccountBillingInput,
} from '../../lib/accountBillingState'

/**
 * Billing-state pill for an account ("Billed through 14/11/2026",
 * "Due since 15/12/2026", …). Same visual language as the item pill on the
 * account Items tab.
 */
export function AccountBillingPill({ account, today }: { account: AccountBillingInput; today: string }) {
  const t = useT()
  const locale = useLocale()
  const state = accountBillingState(account, today)
  const date = formatBillingDay(state.date, locale)
  const label = (() => {
    switch (state.status) {
      case 'inactive':
        return t('billing.common.inactive', 'Inactive')
      case 'due':
        return `${t('billing.accounts.state.due', 'Due since')} ${date}`
      case 'not_billed':
        return t('billing.accounts.state.not_billed', 'Not billed yet')
      case 'current':
        return `${t('billing.accounts.state.current', 'Billed through')} ${date}`
    }
  })()
  return <Tag variant={accountBillingTone(state)}>{label}</Tag>
}
