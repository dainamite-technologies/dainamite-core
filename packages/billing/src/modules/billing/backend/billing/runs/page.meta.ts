import React from 'react'
import { PlayCircle } from 'lucide-react'

const runsIcon = React.createElement(PlayCircle, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.run.view'],
  pageTitle: 'Bill Runs',
  pageTitleKey: 'billing.runs.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 30,
  icon: runsIcon,
  breadcrumb: [{ label: 'Bill Runs', labelKey: 'billing.runs.title' }],
} as const
