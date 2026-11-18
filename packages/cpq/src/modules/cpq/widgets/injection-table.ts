import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

// Tab labels: the sales document page translates `groupLabel` as an i18n key
// (`t(groupLabel, metadata.title)`), so the sales tabs use CPQ keys. The
// customers detail pages (legacy v1) render `groupLabel` verbatim, so the
// customer-inventory tab keeps plain English until the host translates it
// (spec 2026-11-15-cpq-multi-language, Risks).

export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.quote:tabs': [
    {
      widgetId: 'cpq.injection.quote-configurator',
      kind: 'tab',
      groupLabel: 'cpq.widgets.quoteConfigurator.tab',
      groupDescription: 'Configure, price, and manage quote offerings',
      priority: 70,
    },
  ],
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'cpq.injection.order-cpq-tab',
      kind: 'tab',
      groupLabel: 'cpq.widgets.orderCpqTab.tab',
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
