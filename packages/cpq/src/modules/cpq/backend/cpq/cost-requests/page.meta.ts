import React from 'react'
import { ClipboardList } from 'lucide-react'

const costRequestsIcon = React.createElement(ClipboardList, { size: 16 })

export const metadata = {
  requireAuth: true,
  // Q13: procurement answers requests, so the page needs the manage feature on top of the view one.
  requireFeatures: ['cpq.costs.view', 'cpq.costs.manage'],
  pageTitle: 'Cost requests',
  pageTitleKey: 'cpq.costRequests.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 4,
  icon: costRequestsIcon,
  breadcrumb: [{ label: 'Cost requests', labelKey: 'cpq.costRequests.title' }],
} as const
