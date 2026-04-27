import React from 'react'
import { FileText } from 'lucide-react'

const quotesIcon = React.createElement(FileText, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.quotes.view'],
  pageTitle: 'CPQ Quotes',
  pageTitleKey: 'cpq.quotes.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'cpq.nav.group',
  pageOrder: 90,
  icon: quotesIcon,
  breadcrumb: [{ label: 'CPQ Quotes', labelKey: 'cpq.quotes.title' }],
} as const
