import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.quote:tabs': [
    {
      widgetId: 'cpq.injection.quote-configurator',
      kind: 'tab',
      groupLabel: 'CPQ Configuration',
      groupDescription: 'Configure, price, and manage quote offerings',
      priority: 70,
    },
  ],
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'cpq.injection.order-cpq-tab',
      kind: 'tab',
      groupLabel: 'CPQ Order',
      groupDescription: 'View the CPQ order associated with this sales order',
      priority: 60,
    },
  ],
  'detail:customers.company:tabs': [
    {
      widgetId: 'cpq.injection.customer-inventory',
      kind: 'tab',
      groupLabel: 'Inventory',
      groupDescription: 'Products and services purchased by this customer',
      priority: 60,
    },
  ],
  'detail:customers.person:tabs': [
    {
      widgetId: 'cpq.injection.customer-inventory',
      kind: 'tab',
      groupLabel: 'Inventory',
      groupDescription: 'Products and services purchased by this customer',
      priority: 60,
    },
  ],
}

export default injectionTable
