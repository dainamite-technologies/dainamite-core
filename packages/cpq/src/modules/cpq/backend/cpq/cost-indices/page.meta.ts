import React from 'react'
import { TrendingUp } from 'lucide-react'
import { COST_INDEX_READ_FEATURES } from '../../../data/cost-indices'

const costIndicesIcon = React.createElement(TrendingUp, { size: 16 })

export const metadata = {
  requireAuth: true,
  // Index values are cost data (spec Q13): the page needs the costs view feature on top of the pricing one.
  requireFeatures: [...COST_INDEX_READ_FEATURES],
  pageTitle: 'Cost indices',
  pageTitleKey: 'cpq.costIndices.list.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 22,
  icon: costIndicesIcon,
  breadcrumb: [{ label: 'Cost indices', labelKey: 'cpq.costIndices.list.title' }],
} as const
