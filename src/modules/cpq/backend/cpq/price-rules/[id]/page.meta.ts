export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.pricing.view'],
  navHidden: true,
  breadcrumb: [
    { label: 'Price Rules', labelKey: 'cpq.priceRules.list.title', href: '/backend/cpq/price-rules' },
    { label: 'Rule Detail' },
  ],
} as const
