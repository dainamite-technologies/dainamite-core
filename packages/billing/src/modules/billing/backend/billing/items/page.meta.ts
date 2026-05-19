import React from 'react'
import { Receipt } from 'lucide-react'

const itemsIcon = React.createElement(Receipt, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.item.view'],
  pageTitle: 'Billing Items',
  pageTitleKey: 'billing.items.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 25,
  icon: itemsIcon,
  breadcrumb: [{ label: 'Billing Items', labelKey: 'billing.items.title' }],
} as const
