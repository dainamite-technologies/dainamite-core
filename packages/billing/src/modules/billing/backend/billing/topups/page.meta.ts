import React from 'react'
import { Wallet } from 'lucide-react'

const topupsIcon = React.createElement(Wallet, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.topup.view'],
  pageTitle: 'Top-ups',
  pageTitleKey: 'billing.topups.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 50,
  icon: topupsIcon,
  breadcrumb: [{ label: 'Top-ups', labelKey: 'billing.topups.title' }],
} as const
