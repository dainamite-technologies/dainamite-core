import React from 'react'
import { Receipt } from 'lucide-react'

const billingSettingsIcon = React.createElement(Receipt, { size: 16 })

// Spec 0 — billing settings (prepaid defaults + document number masks).
// Lives in the settings area next to other module configs.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['billing.settings.view'],
  pageTitle: 'Billing',
  pageTitleKey: 'billing.settings.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 20,
  icon: billingSettingsIcon,
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [{ label: 'Billing', labelKey: 'billing.settings.title' }],
} as const
