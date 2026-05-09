export const metadata = {
  requireAuth: true,
  requireFeatures: ['cpq.inventory.view'],
  navHidden: true,
  breadcrumb: [
    { label: 'Customer Inventory', labelKey: 'cpq.inventory.title', href: '/backend/cpq/inventory' },
    { label: 'Subscription Detail' },
  ],
} as const
