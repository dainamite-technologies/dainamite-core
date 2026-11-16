"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  accountBillingState,
  accountBillingTone,
  type AccountBillingInput,
} from '../../lib/accountBillingState'
import { formatDateOnly } from '../../lib/dateOnly'

/**
 * Billing-state pill for an account ("Billed through 14/11/2026",
 * "Due since 15/12/2026", …). Same visual language as the item pill on the
 * account Items tab.
 */
export function AccountBillingPill({ account, today }: { account: AccountBillingInput; today: string }) {
  const t = useT()
  const state = accountBillingState(account, today)
  const date = formatDateOnly(state.date)
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
