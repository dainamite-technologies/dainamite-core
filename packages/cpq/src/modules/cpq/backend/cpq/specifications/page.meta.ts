import React from 'react'
import { Box } from 'lucide-react'

const specificationsIcon = React.createElement(Box, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.specifications.view'],
  pageTitle: 'Product Specifications',
  pageTitleKey: 'cpq.specifications.list.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 12,
  icon: specificationsIcon,
  breadcrumb: [{ label: 'Product Specifications', labelKey: 'cpq.specifications.list.title' }],
} as const
