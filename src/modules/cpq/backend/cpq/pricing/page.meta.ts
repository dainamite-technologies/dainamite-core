import React from 'react'
import { Calculator } from 'lucide-react'

const pricingIcon = React.createElement(Calculator, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.pricing.view'],
  pageTitle: 'Pricing Tables',
  pageTitleKey: 'cpq.pricing.list.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'cpq.nav.group',
  pageOrder: 20,
  icon: pricingIcon,
  breadcrumb: [{ label: 'Pricing Tables', labelKey: 'cpq.pricing.list.title' }],
} as const
