import React from 'react'
import { ClipboardList } from 'lucide-react'

const ordersIcon = React.createElement(ClipboardList, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.orders.view'],
  pageTitle: 'CPQ Orders',
  pageTitleKey: 'cpq.orders.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'cpq.nav.group',
  pageOrder: 91,
  icon: ordersIcon,
  breadcrumb: [{ label: 'CPQ Orders', labelKey: 'cpq.orders.title' }],
} as const
