import React from 'react'
import { Building2 } from 'lucide-react'

const accountIcon = React.createElement(Building2, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.account.view'],
  pageTitle: 'Billing Account',
  pageTitleKey: 'billing.accounts.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: accountIcon,
  breadcrumb: [
    {
      label: 'Billing Accounts',
      labelKey: 'billing.accounts.title',
      href: '/backend/billing/accounts',
    },
    { label: 'Account', labelKey: 'billing.accounts.detail.title' },
  ],
} as const
