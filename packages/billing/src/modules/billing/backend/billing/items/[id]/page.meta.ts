import React from 'react'
import { Receipt } from 'lucide-react'

const itemIcon = React.createElement(Receipt, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.item.view'],
  pageTitle: 'Billing Item',
  pageTitleKey: 'billing.items.detail.title',
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
    { label: 'Item', labelKey: 'billing.items.detail.title' },
  ],
} as const
