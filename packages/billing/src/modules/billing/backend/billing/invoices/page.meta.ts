import React from 'react'
import { FileText } from 'lucide-react'

const invoicesIcon = React.createElement(FileText, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.invoice.view'],
  pageTitle: 'Billing Invoices',
  pageTitleKey: 'billing.invoices.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 30,
  icon: invoicesIcon,
  breadcrumb: [{ label: 'Billing Invoices', labelKey: 'billing.invoices.title' }],
} as const
