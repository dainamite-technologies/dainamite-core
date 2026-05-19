import React from 'react'
import { FileText } from 'lucide-react'

const invoiceIcon = React.createElement(FileText, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.invoice.view'],
  pageTitle: 'Billing Invoice',
  pageTitleKey: 'billing.invoices.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: invoiceIcon,
  breadcrumb: [
    {
      label: 'Billing Invoices',
      labelKey: 'billing.invoices.title',
      href: '/backend/billing/invoices',
    },
    { label: 'Invoice', labelKey: 'billing.invoices.detail.title' },
  ],
} as const
