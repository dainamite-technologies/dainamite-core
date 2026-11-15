import React from 'react'
import { Landmark } from 'lucide-react'

const paymentsIcon = React.createElement(Landmark, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.payment.view'],
  pageTitle: 'Payments',
  pageTitleKey: 'billing.payments.title',
  pageGroup: 'Billing',
  pageGroupKey: 'billing.nav.group',
  pageOrder: 45,
  icon: paymentsIcon,
  breadcrumb: [{ label: 'Payments', labelKey: 'billing.payments.title' }],
} as const
