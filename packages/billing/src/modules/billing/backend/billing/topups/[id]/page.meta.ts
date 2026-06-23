import React from 'react'
import { Wallet } from 'lucide-react'

const topupIcon = React.createElement(Wallet, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.topup.view'],
  pageTitle: 'Top-up',
  pageTitleKey: 'billing.topups.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: topupIcon,
  breadcrumb: [
    { label: 'Top-ups', labelKey: 'billing.topups.title', href: '/backend/billing/topups' },
    { label: 'Top-up', labelKey: 'billing.topups.detail.title' },
  ],
} as const
