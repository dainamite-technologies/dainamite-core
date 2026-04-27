import React from 'react'
import { Scale } from 'lucide-react'

const priceRulesIcon = React.createElement(Scale, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.pricing.view'],
  pageTitle: 'Price Rules',
  pageTitleKey: 'cpq.priceRules.list.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 21,
  icon: priceRulesIcon,
  breadcrumb: [{ label: 'Price Rules', labelKey: 'cpq.priceRules.list.title' }],
} as const
