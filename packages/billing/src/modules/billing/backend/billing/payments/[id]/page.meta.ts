import React from 'react'
import { Landmark } from 'lucide-react'

const paymentIcon = React.createElement(Landmark, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.payment.view'],
  pageTitle: 'Payment',
  pageTitleKey: 'billing.payments.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  navHidden: true,
  icon: paymentIcon,
  breadcrumb: [
    { label: 'Payments', labelKey: 'billing.payments.title', href: '/backend/billing/payments' },
    { label: 'Payment', labelKey: 'billing.payments.detail.title' },
  ],
} as const
