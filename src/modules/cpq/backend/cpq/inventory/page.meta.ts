import React from 'react'
import { Package } from 'lucide-react'

const inventoryIcon = React.createElement(Package, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.inventory.view'],
  pageTitle: 'CPQ Subscriptions',
  pageTitleKey: 'cpq.inventory.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 92,
  icon: inventoryIcon,
  breadcrumb: [{ label: 'CPQ Subscriptions', labelKey: 'cpq.inventory.title' }],
} as const
