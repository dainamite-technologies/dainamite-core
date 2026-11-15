import React from 'react'
import { Landmark } from 'lucide-react'

const importIcon = React.createElement(Landmark, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.payment.view'],
  pageTitle: 'Payment import',
  pageTitleKey: 'billing.payments.import.detail_title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: importIcon,
  breadcrumb: [
    { label: 'Payments', labelKey: 'billing.payments.title', href: '/backend/billing/payments' },
    { label: 'Import', labelKey: 'billing.payments.import.detail_title' },
  ],
} as const
