import React from 'react'
import { Package } from 'lucide-react'

const offeringsIcon = React.createElement(Package, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.offerings.view'],
  pageTitle: 'Product Offerings',
  pageTitleKey: 'cpq.offerings.list.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 13,
  icon: offeringsIcon,
  breadcrumb: [{ label: 'Product Offerings', labelKey: 'cpq.offerings.list.title' }],
} as const
