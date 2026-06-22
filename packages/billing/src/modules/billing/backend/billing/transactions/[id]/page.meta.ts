import React from 'react'
import { ArrowLeftRight } from 'lucide-react'

const transactionIcon = React.createElement(ArrowLeftRight, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.balance.view'],
  pageTitle: 'Transaction',
  pageTitleKey: 'billing.transactions.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: transactionIcon,
  breadcrumb: [
    { label: 'Transactions', labelKey: 'billing.transactions.title', href: '/backend/billing/transactions' },
    { label: 'Transaction', labelKey: 'billing.transactions.detail.title' },
  ],
} as const
