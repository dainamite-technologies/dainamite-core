import React from 'react'
import { Receipt } from 'lucide-react'

const itemIcon = React.createElement(Receipt, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.item.manage'],
  pageTitle: 'Create Billing Item',
  pageTitleKey: 'billing.items.create.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: itemIcon,
  breadcrumb: [
    {
      label: 'Billing Items',
      labelKey: 'billing.items.title',
      href: '/backend/billing/items',
    },
    { label: 'Create', labelKey: 'billing.items.create.title' },
  ],
} as const
