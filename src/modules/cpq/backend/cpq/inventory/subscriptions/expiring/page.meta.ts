import React from 'react'
import { CalendarClock } from 'lucide-react'

const expiringIcon = React.createElement(CalendarClock, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.inventory.expiring.view'],
  pageTitle: 'Expiring Subscriptions',
  pageTitleKey: 'cpq.inventory.expiring.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 93,
  icon: expiringIcon,
  breadcrumb: [{ label: 'Expiring Subscriptions', labelKey: 'cpq.inventory.expiring.title' }],
} as const
