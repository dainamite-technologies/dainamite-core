import React from 'react'
import { PlayCircle } from 'lucide-react'

const runIcon = React.createElement(PlayCircle, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.run.view'],
  pageTitle: 'Bill Run',
  pageTitleKey: 'billing.runs.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: runIcon,
  breadcrumb: [
    { label: 'Bill Runs', labelKey: 'billing.runs.title', href: '/backend/billing/runs' },
    { label: 'Run', labelKey: 'billing.runs.detail.title' },
  ],
} as const
