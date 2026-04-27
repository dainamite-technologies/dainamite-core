import React from 'react'
import { Wand2 } from 'lucide-react'

const wizardsIcon = React.createElement(Wand2, { size: 16 })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.wizards.view'],
  pageTitle: 'Wizards',
  pageTitleKey: 'cpq.wizards.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'cpq.nav.group',
  pageOrder: 35,
  icon: wizardsIcon,
  breadcrumb: [{ label: 'Wizards', labelKey: 'cpq.wizards.title' }],
} as const
