import React from 'react'
import { Gauge } from 'lucide-react'

const usageIcon = React.createElement(Gauge, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.usage.ingest'],
  pageTitle: 'Record Usage',
  pageTitleKey: 'billing.usage.create.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: usageIcon,
  breadcrumb: [
    {
      label: 'Billing Accounts',
      labelKey: 'billing.accounts.title',
      href: '/backend/billing/accounts',
    },
    { label: 'Record Usage', labelKey: 'billing.usage.create.title' },
  ],
} as const
