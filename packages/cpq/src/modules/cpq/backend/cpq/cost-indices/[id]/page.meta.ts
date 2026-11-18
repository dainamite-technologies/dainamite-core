import { COST_INDEX_READ_FEATURES } from '../../../../data/cost-indices'

export const metadata = {
  requireAuth: true,
  requireFeatures: [...COST_INDEX_READ_FEATURES],
  pageTitle: 'Cost index',
  pageTitleKey: 'cpq.costIndices.detail.title',
  pageGroup: 'CPQ',
  pageGroupKey: 'customers~sales~cpq.nav.group',
  pageOrder: 22,
  navHidden: true,
  breadcrumb: [
    { label: 'Cost indices', labelKey: 'cpq.costIndices.list.title', href: '/backend/cpq/cost-indices' },
    { label: 'Cost index', labelKey: 'cpq.costIndices.detail.title' },
  ],
} as const
