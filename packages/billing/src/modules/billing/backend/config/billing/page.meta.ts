import React from 'react'
import { Receipt } from 'lucide-react'

const billingSettingsIcon = React.createElement(Receipt, { size: 16 })

// Spec 0 — billing settings (prepaid defaults + document number masks).
// Lives in the settings area next to other module configs. No `navHidden`:
// the nav builder drops navHidden routes from the Settings sidebar too
// (Spec F, F6).
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
  breadcrumb: [{ label: 'Billing', labelKey: 'billing.settings.title' }],
} as const
