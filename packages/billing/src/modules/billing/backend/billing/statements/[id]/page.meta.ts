import React from 'react'
import { FileText } from 'lucide-react'

const statementIcon = React.createElement(FileText, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.statement.view'],
  pageTitle: 'Statement',
  pageTitleKey: 'billing.statements.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: statementIcon,
  breadcrumb: [
    { label: 'Statements', labelKey: 'billing.statements.title', href: '/backend/billing/statements' },
    { label: 'Statement', labelKey: 'billing.statements.detail.title' },
  ],
} as const
