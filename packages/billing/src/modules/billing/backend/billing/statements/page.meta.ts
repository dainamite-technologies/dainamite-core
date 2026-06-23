import React from 'react'
import { FileText } from 'lucide-react'

const statementsIcon = React.createElement(FileText, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.statement.view'],
  pageTitle: 'Statements',
  pageTitleKey: 'billing.statements.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 60,
  icon: statementsIcon,
  breadcrumb: [{ label: 'Statements', labelKey: 'billing.statements.title' }],
} as const
