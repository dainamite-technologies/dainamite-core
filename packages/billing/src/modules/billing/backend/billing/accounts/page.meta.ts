import React from 'react'
import { Building2 } from 'lucide-react'

const accountsIcon = React.createElement(Building2, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.account.view'],
  pageTitle: 'Billing Accounts',
  pageTitleKey: 'billing.accounts.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 20,
  icon: accountsIcon,
  breadcrumb: [{ label: 'Billing Accounts', labelKey: 'billing.accounts.title' }],
} as const
