import React from 'react'
import { ArrowLeftRight } from 'lucide-react'

const transactionsIcon = React.createElement(ArrowLeftRight, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.balance.view'],
  pageTitle: 'Transactions',
  pageTitleKey: 'billing.transactions.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 70,
  icon: transactionsIcon,
  breadcrumb: [{ label: 'Transactions', labelKey: 'billing.transactions.title' }],
} as const
