export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.pricing.view'],
  navHidden: true,
  breadcrumb: [
    { label: 'Price Rules', labelKey: 'cpq.priceRules.list.title', href: '/backend/cpq/price-rules' },
    { label: 'Rule Detail', labelKey: 'cpq.priceRules.detail.breadcrumb' },
  ],
} as const
